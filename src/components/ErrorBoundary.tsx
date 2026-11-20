import { Component, type ErrorInfo, type ReactNode } from "react";

/** Keeps a render crash from leaving a blank window with no way out: the note
 *  text is not worth losing to a component that threw. */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("TextOne 渲染出错", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h1>界面出错了</h1>
        <p className="crash-message">{String(this.state.error)}</p>
        <p className="crash-hint">
          笔记文件没有被改动。重开窗口即可回来；如果一直出错，请把这段信息发给我。
        </p>
        <button className="crash-action" onClick={() => location.reload()}>
          重新载入
        </button>
      </div>
    );
  }
}
