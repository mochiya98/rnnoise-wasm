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
}
/**
 * WebAssembly 用にビルドした [RNNoise](https://github.com/shiguredo/rnnoise) の API を提供するためのクラス
 *
 * インスタンスを作成するためには {@link Rnnoise.load} 関数を使用してください
 */
declare class Rnnoise {
    private rnnoiseModule;
    /**
     * 一度の {@link DenoiseState.processFrame} メソッド呼び出しで処理可能なサンプル数
     */
    readonly frameSize: number;
    private constructor();
    /**
     * wasm ファイルをロードして {@link Rnnoise} のインスタンスを生成する関数
     *
     * @param options 指定可能なオプション群
     * @returns 生成された {@link Rnnoise} インスタンス
     *
     * @remarks
     * 実行環境が WebAssembly の SIMD に対応している場合には、SIMD 版の wasm ファイルがロードされます
     */
    static load(): Rnnoise;
    /**
     * ノイズ抑制を行うための {@link DenoiseState} インスタンスを生成します
     *
     * @param model 使用するノイズ抑制モデル（省略時はデフォルトモデル）
     * @returns 生成されたインスタンス
     */
    createDenoiseState(model?: Model): DenoiseState;
    /**
     * ノイズ抑制に使用する RNNoise のモデルを生成します
     *
     * @param モデル定義文字列
     * @return 生成されたモデルインスタンス
     */
    createModel(modelString: string): Model;
}
/**
 * ノイズ抑制に必要な状態を保持するクラス
 *
 * インスタンスを作成するためには {@link Rnnoise.createDenoiseState} メソッドを使用してください
 *
 * なお、メモリリークを防ぐために、インスタンスが不要となったら {@link DenoiseState.destroy} メソッドを
 * 呼び出す必要があることに注意してください
 */
declare class DenoiseState {
    private rnnoiseModule?;
    private state;
    private pcmInputBuf;
    private pcmOutputBuf;
    private frameSize;
    /**
     * 使用しているノイズ抑制モデル
     *
     * `undefined` の場合はデフォルトモデルが使われていることを意味します
     */
    readonly model?: Model;
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
    processFrame(frame: Float32Array): number;
    /**
     * インスタンスが割り当てた wasm 内の領域を解放します
     *
     * 本メソッド呼び出し後に {@link DenoiseState.processFrame} メソッドを呼ぶとエラーとなります
     */
    destroy(): void;
}
/**
 * ノイズ抑制に使用する RNNoise のモデル
 *
 * インスタンスを作成するためには {@link Rnnoise.createModel} メソッドを使用してください
 */
declare class Model {
    private rnnoiseModule?;
    /**
     * モデルに割り当てられた wasm 内の領域を解放します
     *
     * このモデルを参照している {@link DenoiseState} が存在する場合には、
     * 先にそちらの {@link DenoiseState.destroy} メソッドを呼ぶように注意してください
     */
    free(): void;
}
export { Rnnoise, RnnoiseOptions, DenoiseState, Model };
