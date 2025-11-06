import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { WelcomePanel } from './WelcomePanel';

// mock vscode - using explicit external to avoid bundling issues
vi.mock('vscode', () => ({
  ViewColumn: {
    One: 1,
  },
  window: {
    createWebviewPanel: vi.fn(),
  },
  commands: {
    executeCommand: vi.fn(),
  },
  Uri: class {
    static file(path: string) {
      return { fsPath: path };
    }
  },
}));

describe('WelcomePanel', () => {
  beforeEach(() => {
    // reset current panel
    WelcomePanel.currentPanel = undefined;
    vi.clearAllMocks();
  });

  describe('show', () => {
    it('should create a new webview panel', () => {
      const extensionUri = { fsPath: '/test' } as any;
      const mockPanel = {
        webview: { html: '', onDidReceiveMessage: vi.fn() },
        onDidDispose: vi.fn(),
        reveal: vi.fn(),
      };

      vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(mockPanel as any);

      WelcomePanel.show(extensionUri);

      expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        'chorusWelcome',
        'Welcome to Chorus',
        1,
        {
          enableScripts: true,
          localResourceRoots: [extensionUri],
        }
      );
    });

    it('should reuse existing panel if already open', () => {
      const extensionUri = { fsPath: '/test' } as any;
      const mockPanel = {
        webview: { html: '', onDidReceiveMessage: vi.fn() },
        onDidDispose: vi.fn(),
        reveal: vi.fn(),
      };

      vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(mockPanel as any);

      // create panel first time
      WelcomePanel.show(extensionUri);

      // reset mock
      vi.clearAllMocks();

      // show panel second time
      WelcomePanel.show(extensionUri);

      // should not create new panel
      expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();

      // should reveal existing panel
      expect(mockPanel.reveal).toHaveBeenCalled();
    });

    it('should set webview html content', () => {
      const extensionUri = { fsPath: '/test' } as any;
      const mockPanel = {
        webview: { html: '', onDidReceiveMessage: vi.fn() },
        onDidDispose: vi.fn(),
        reveal: vi.fn(),
      };

      vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(mockPanel as any);

      WelcomePanel.show(extensionUri);

      expect(mockPanel.webview.html).toContain('Welcome to Chorus');
      expect(mockPanel.webview.html).toContain('Discover Context');
      expect(mockPanel.webview.html).toContain('Add Evidence');
      expect(mockPanel.webview.html).toContain('Submit Ballots');
    });
  });

  describe('webview messages', () => {
    it('should handle showSidebar message', async () => {
      const extensionUri = { fsPath: '/test' } as any;
      let messageHandler: any;

      const mockPanel = {
        webview: {
          html: '',
          onDidReceiveMessage: vi.fn((handler) => {
            messageHandler = handler;
            return { dispose: vi.fn() };
          }),
        },
        onDidDispose: vi.fn((handler) => {
          return { dispose: vi.fn() };
        }),
        reveal: vi.fn(),
      };

      vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(mockPanel as any);

      WelcomePanel.show(extensionUri);

      // simulate message from webview
      await messageHandler({ command: 'showSidebar' });

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith('chorus.focusContextView');
    });

    it('should handle addEvidence message', async () => {
      const extensionUri = { fsPath: '/test' } as any;
      let messageHandler: any;

      const mockPanel = {
        webview: {
          html: '',
          onDidReceiveMessage: vi.fn((handler) => {
            messageHandler = handler;
            return { dispose: vi.fn() };
          }),
        },
        onDidDispose: vi.fn((handler) => {
          return { dispose: vi.fn() };
        }),
        reveal: vi.fn(),
      };

      vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(mockPanel as any);

      WelcomePanel.show(extensionUri);

      // simulate message from webview
      await messageHandler({ command: 'addEvidence' });

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith('chorus.addEvidence');
    });

    it('should handle submitBallot message', async () => {
      const extensionUri = { fsPath: '/test' } as any;
      let messageHandler: any;

      const mockPanel = {
        webview: {
          html: '',
          onDidReceiveMessage: vi.fn((handler) => {
            messageHandler = handler;
            return { dispose: vi.fn() };
          }),
        },
        onDidDispose: vi.fn((handler) => {
          return { dispose: vi.fn() };
        }),
        reveal: vi.fn(),
        dispose: vi.fn(),
      };

      vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(mockPanel as any);

      WelcomePanel.show(extensionUri);

      // simulate message from webview
      await messageHandler({ command: 'submitBallot' });

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith('chorus.quickSubmitBallot');
    });

    it('should dispose panel on dismiss message', async () => {
      const extensionUri = { fsPath: '/test' } as any;
      let messageHandler: any;
      let disposeHandler: any;

      const mockPanel = {
        webview: {
          html: '',
          onDidReceiveMessage: vi.fn((handler) => {
            messageHandler = handler;
            return { dispose: vi.fn() };
          }),
        },
        onDidDispose: vi.fn((handler) => {
          disposeHandler = handler;
          return { dispose: vi.fn() };
        }),
        reveal: vi.fn(),
        dispose: vi.fn(),
      };

      vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(mockPanel as any);

      WelcomePanel.show(extensionUri);

      // simulate message from webview
      await messageHandler({ command: 'dismiss' });

      expect(mockPanel.dispose).toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('should clean up resources on dispose', () => {
      const extensionUri = { fsPath: '/test' } as any;
      let disposeHandler: any;

      const mockPanel = {
        webview: {
          html: '',
          onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
        },
        onDidDispose: vi.fn((handler) => {
          disposeHandler = handler;
          return { dispose: vi.fn() };
        }),
        reveal: vi.fn(),
        dispose: vi.fn(),
      };

      vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(mockPanel as any);

      WelcomePanel.show(extensionUri);

      expect(WelcomePanel.currentPanel).toBeDefined();

      // trigger dispose
      disposeHandler();

      expect(WelcomePanel.currentPanel).toBeUndefined();
    });
  });
});
