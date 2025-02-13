import loadRnnoiseModule from "./rnnoise_simd_wasm.js";
import * as rnnoise_wasm from "./rnnoise_simd_wasm.js";

/**
 * {@link Rnnoise.load} 関数に指定可能なオプション
 */
interface RnnoiseOptions {
  /**
   * wasm ファイルの配置先ディレクトリパス
   *
   * デフォルトでは `rnnoise.js` の配置先と同じディレクトリが使用されます
   */
  assetsPath?: string;

  /**
   * @internal
   *
   * 使用する wasm ファイルの名前（テスト用オプション）
   */
  wasmFileName?: string;
}

/**
 * WebAssembly 用にビルドした [RNNoise](https://github.com/shiguredo/rnnoise) の API を提供するためのクラス
 *
 * インスタンスを作成するためには {@link Rnnoise.load} 関数を使用してください
 */
class Rnnoise {
  private rnnoiseModule: rnnoise_wasm.RnnoiseModule;

  /**
   * 一度の {@link DenoiseState.processFrame} メソッド呼び出しで処理可能なサンプル数
   */
  readonly frameSize: number;

  private constructor(rnnoiseModule: rnnoise_wasm.RnnoiseModule) {
    this.rnnoiseModule = rnnoiseModule;
    this.frameSize = rnnoiseModule._rnnoise_get_frame_size();
  }

  /**
   * wasm ファイルをロードして {@link Rnnoise} のインスタンスを生成する関数
   *
   * @param options 指定可能なオプション群
   * @returns 生成された {@link Rnnoise} インスタンス
   *
   * @remarks
   * 実行環境が WebAssembly の SIMD に対応している場合には、SIMD 版の wasm ファイルがロードされます
   */
  static load(): Rnnoise {
    const rnnoiseModule = loadRnnoiseModule();
    return new Rnnoise(rnnoiseModule);
  }

  /**
   * ノイズ抑制を行うための {@link DenoiseState} インスタンスを生成します
   *
   * @param model 使用するノイズ抑制モデル（省略時はデフォルトモデル）
   * @returns 生成されたインスタンス
   */
  createDenoiseState(model?: Model): DenoiseState {
    return new DenoiseState(this.rnnoiseModule, model);
  }

  /**
   * ノイズ抑制に使用する RNNoise のモデルを生成します
   *
   * @param モデル定義文字列
   * @return 生成されたモデルインスタンス
   */
  createModel(modelString: string): Model {
    return new Model(this.rnnoiseModule, modelString);
  }
}

const F32_BYTE_SIZE = 4;

/**
 * ノイズ抑制に必要な状態を保持するクラス
 *
 * インスタンスを作成するためには {@link Rnnoise.createDenoiseState} メソッドを使用してください
 *
 * なお、メモリリークを防ぐために、インスタンスが不要となったら {@link DenoiseState.destroy} メソッドを
 * 呼び出す必要があることに注意してください
 */
class DenoiseState {
  private rnnoiseModule?: rnnoise_wasm.RnnoiseModule;
  private state: rnnoise_wasm.DenoiseState;
  private pcmInputBuf: rnnoise_wasm.F32Ptr;
  private pcmOutputBuf: rnnoise_wasm.F32Ptr;
  private frameSize: number;

  /**
   * 使用しているノイズ抑制モデル
   *
   * `undefined` の場合はデフォルトモデルが使われていることを意味します
   */
  readonly model?: Model;

  /**
   * @internal
   */
  constructor(rnnoiseModule: rnnoise_wasm.RnnoiseModule, model?: Model) {
    this.rnnoiseModule = rnnoiseModule;
    this.model = model;

    this.frameSize = this.rnnoiseModule._rnnoise_get_frame_size();
    let state;
    if (model !== undefined) {
      state = this.rnnoiseModule._rnnoise_create(model.model);
    } else {
      state = this.rnnoiseModule._rnnoise_create();
    }
    const pcmInputBuf = this.rnnoiseModule._malloc(this.frameSize * F32_BYTE_SIZE);
    const pcmOutputBuf = this.rnnoiseModule._malloc(this.frameSize * F32_BYTE_SIZE);
    if (!state || !pcmInputBuf || !pcmOutputBuf) {
      this.destroy();
      throw Error("Failed to allocate DenoiseState or PCM buffers.");
    }

    this.state = state;
    this.pcmInputBuf = pcmInputBuf;
    this.pcmOutputBuf = pcmOutputBuf;
  }

  /**
   * 音声フレームにノイズ抑制処理を適用するメソッド
   *
   * @param frame ノイズ抑制処理の対象となる音声フレーム

   * @returns
   * VAD (voice-activity-detection) の結果を返します
   *
   * 結果の範囲は0から1で、値が大きいほど、入力音声フレームに人の声が含まれている可能性が高いことを意味します
   *
   * @throws
   * 入力音声フレームに含まれるサンプルの数 (`frame.length`) が {@link Rnnoise.frameSize} と異なる場合にエラーが送出されます
   *
   * @remarks
   * RNNoise は入力音声フレームが 16ビットPCM であると仮定しているため、
   * それ以外のフォーマットのフレームを処理したい場合には、
   * 呼び出し側で事前に変換を行っておく必要があります
   */
  processFrame(frame: Float32Array): number {
    if (this.rnnoiseModule === undefined) {
      throw Error("This denoise state has already been destroyed.");
    }

    if (frame.length != this.frameSize) {
      throw Error(`Expected frame size ${this.frameSize}, but got ${frame.length}`);
    }

    const pcmInputIndex = this.pcmInputBuf / F32_BYTE_SIZE;
    const pcmOutputIndex = this.pcmOutputBuf / F32_BYTE_SIZE;

    this.rnnoiseModule.HEAPF32.set(frame, pcmInputIndex);
    const vad = this.rnnoiseModule._rnnoise_process_frame(this.state, this.pcmOutputBuf, this.pcmInputBuf);
    frame.set(this.rnnoiseModule.HEAPF32.subarray(pcmOutputIndex, pcmOutputIndex + this.frameSize));

    return vad;
  }

  /**
   * インスタンスが割り当てた wasm 内の領域を解放します
   *
   * 本メソッド呼び出し後に {@link DenoiseState.processFrame} メソッドを呼ぶとエラーとなります
   */
  destroy() {
    if (this.rnnoiseModule !== undefined) {
      this.rnnoiseModule._rnnoise_destroy(this.state);
      this.rnnoiseModule._free(this.pcmInputBuf);
      this.rnnoiseModule._free(this.pcmOutputBuf);
      this.rnnoiseModule = undefined;
    }
  }
}

/**
 * ノイズ抑制に使用する RNNoise のモデル
 *
 * インスタンスを作成するためには {@link Rnnoise.createModel} メソッドを使用してください
 */
class Model {
  private rnnoiseModule?: rnnoise_wasm.RnnoiseModule;

  /**
   * @internal
   **/
  readonly model: rnnoise_wasm.RNNModel;

  /**
   * @internal
   **/
  constructor(rnnoiseModule: rnnoise_wasm.RnnoiseModule, modelString: string) {
    this.rnnoiseModule = rnnoiseModule;

    // モデル定義文字列を、ヌル終端文字列に変換してから `rnnoise_model_from_string` 関数を呼び出す
    const modelCString = new TextEncoder().encode(modelString + "\x00");
    const modelCStringPtr = rnnoiseModule._malloc(modelCString.length);
    rnnoiseModule.HEAPU8.subarray(modelCStringPtr, modelCStringPtr + modelCString.length).set(modelCString);
    this.model = rnnoiseModule._rnnoise_model_from_string(modelCStringPtr);
    rnnoiseModule._free(modelCStringPtr);

    if (!this.model) {
      throw Error("Failed to create Model from a given model string.");
    }
  }

  /**
   * モデルに割り当てられた wasm 内の領域を解放します
   *
   * このモデルを参照している {@link DenoiseState} が存在する場合には、
   * 先にそちらの {@link DenoiseState.destroy} メソッドを呼ぶように注意してください
   */
  free(): void {
    if (this.rnnoiseModule !== undefined) {
      this.rnnoiseModule._rnnoise_model_free(this.model);
      this.rnnoiseModule = undefined;
    }
  }
}

export { Rnnoise, RnnoiseOptions, DenoiseState, Model };
