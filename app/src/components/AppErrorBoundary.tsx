import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportRuntimeLog } from "../lib/runtimeLogs";

interface AppErrorBoundaryProps {
  children: ReactNode;
  scope: string;
  resetKey?: string;
  onReset?: () => void;
  onSafeMode?: () => void;
}

interface AppErrorBoundaryState {
  error: Error | null;
  diagnosticId: string;
}

function diagnosticId() {
  return globalThis.crypto?.randomUUID?.() || `error-${Date.now().toString(36)}`;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null, diagnosticId: "" };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error, diagnosticId: diagnosticId() };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void reportRuntimeLog({
      source: this.props.scope,
      message: error.message || "页面组件运行失败",
      error,
      context: {
        diagnosticId: this.state.diagnosticId,
        componentStack: (info.componentStack || "").slice(0, 2000),
        path: window.location.hash || window.location.pathname
      }
    });
  }

  componentDidUpdate(previous: AppErrorBoundaryProps) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null, diagnosticId: "" });
    }
  }

  private reset = () => {
    this.setState({ error: null, diagnosticId: "" });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return <section className="recovery-screen" role="alert">
      <div>
        <span>RECOVERY MODE</span>
        <h1>页面运行时发生异常</h1>
        <p>内容没有被删除。可以重新打开当前区域，或使用安全模式查看并保存已有资料。</p>
        <small>诊断编号：{this.state.diagnosticId}</small>
        <details><summary>错误详情</summary><code>{this.state.error.message}</code></details>
        <div className="recovery-actions">
          <button className="button primary" type="button" onClick={this.reset}>重新打开</button>
          {this.props.onSafeMode && <button className="button quiet" type="button" onClick={this.props.onSafeMode}>安全模式</button>}
          <button className="button quiet" type="button" onClick={() => window.location.reload()}>刷新页面</button>
        </div>
      </div>
    </section>;
  }
}
