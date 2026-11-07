import type { Context } from '@deepseek-ai/cordis';

/** The Client Workspace projection exposed by @deepseek-ai/dsh-api-workspace-controller. */
export interface WorkspaceView {
  readonly workspaceId: string;
  readonly path: string;
  readonly title: string;
}

export interface WorkspaceListSnapshot {
  readonly items: readonly WorkspaceView[];
  readonly state?: string;
  readonly phase?: string;
}

export interface WorkspaceListModel {
  getSnapshot(): WorkspaceListSnapshot;
  subscribe(listener: () => void): () => void;
}

export interface WorkspaceClientService {
  readonly list: WorkspaceListModel;
}

/**
 * Read the optional Client Workspace service without making plugin loading
 * depend on it. A minimal Client can hide the project selector, but every
 * normal DSH Web deployment composes this service.
 */
export function workspaceListOf(ctx: Context): WorkspaceListModel | undefined {
  try {
    const service = (ctx as unknown as { get(name: string): unknown }).get('workspaces') as WorkspaceClientService | undefined;
    return service?.list;
  } catch {
    return undefined;
  }
}
