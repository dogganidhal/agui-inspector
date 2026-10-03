// Keeps a render failure inside the pane that hit it. Without a boundary React unmounts the whole page
// when a view throws, and the capture can no longer be reached. The fallback names the pane and the
// error; the shell, the other panes and the composer keep working.
import { Component, type ReactNode } from 'react';
import { Finding } from '../views/theme/index';

const MAX_MESSAGE = 200;

export interface PaneBoundaryProps {
  /** What the pane is called in the message: "conversation", "inspection", "state". */
  readonly pane: string;
  /** The fallback gives way to the children again when this changes, such as the store on screen. */
  readonly resetKey: unknown;
  /** Called once per failure, after the fallback is chosen. */
  readonly onCatch?: (pane: string, error: Error) => void;
  readonly children: ReactNode;
}

interface PaneBoundaryState {
  readonly error?: Error;
}

export const describeError = (error: Error): string => (error.message.length > MAX_MESSAGE ? `${error.message.slice(0, MAX_MESSAGE)}…` : error.message) || error.name;

export class PaneBoundary extends Component<PaneBoundaryProps, PaneBoundaryState> {
  override state: PaneBoundaryState = {};

  static getDerivedStateFromError(error: unknown): PaneBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error): void {
    this.props.onCatch?.(this.props.pane, error);
  }

  override componentDidUpdate(previous: PaneBoundaryProps): void {
    if (this.state.error !== undefined && previous.resetKey !== this.props.resetKey) this.setState({ error: undefined });
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === undefined) return this.props.children;
    return (
      <div role="alert" className="agui-app-pane-error" data-pane-error={this.props.pane}>
        <Finding variant="err" kind="Error">
          The {this.props.pane} pane could not be shown: {describeError(error)}. The rest of the inspector is unaffected.
        </Finding>
      </div>
    );
  }
}
