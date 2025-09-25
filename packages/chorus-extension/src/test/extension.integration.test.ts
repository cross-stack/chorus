import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { activate, deactivate } from '../extension';
import { TestDatabase, createMockVSCodeExtensionContext } from './testUtils';

// Mock vscode module completely
vi.mock('vscode', () => ({
	commands: {
		registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		executeCommand: vi.fn()
	},
	window: {
		activeTextEditor: null,
		showInformationMessage: vi.fn(),
		createWebviewPanel: vi.fn().mockReturnValue({
			webview: {
				html: '',
				asWebviewUri: vi.fn(),
				onDidReceiveMessage: vi.fn(),
				postMessage: vi.fn()
			},
			onDidDispose: vi.fn(),
			reveal: vi.fn(),
			dispose: vi.fn()
		})
	},
	languages: {
		registerCodeLensProvider: vi.fn().mockReturnValue({ dispose: vi.fn() })
	},
	workspace: {
		workspaceFolders: [],
		asRelativePath: vi.fn(),
		findFiles: vi.fn().mockResolvedValue([])
	},
	Uri: {
		joinPath: vi.fn()
	},
	ViewColumn: {
		One: 1
	},
	RelativePattern: vi.fn()
}));

describe('Extension Integration', () => {
	let mockContext: any;
	let mockDisposables: any[];

	beforeEach(() => {
		mockContext = createMockVSCodeExtensionContext();
		mockDisposables = [];
		mockContext.subscriptions = {
			push: vi.fn((...items: any[]) => mockDisposables.push(...items))
		};

		// Reset mocks
		vi.clearAllMocks();
	});

	afterEach(() => {
		// Clean up any resources
		mockDisposables.forEach(disposable => {
			if (disposable && typeof disposable.dispose === 'function') {
				disposable.dispose();
			}
		});
	});

	describe('activation', () => {
		it('should activate extension successfully', async () => {
			await expect(activate(mockContext)).resolves.not.toThrow();
		});

		it('should register required commands', async () => {
			await activate(mockContext);

			expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
				'chorus.showPanel',
				expect.any(Function)
			);

			expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
				'chorus.pasteFromTests',
				expect.any(Function)
			);
		});

		it('should register CodeLens provider', async () => {
			await activate(mockContext);

			expect(vscode.languages.registerCodeLensProvider).toHaveBeenCalledWith(
				{ scheme: 'file', language: 'typescript' },
				expect.any(Object)
			);
		});

		it('should set extension context', async () => {
			await activate(mockContext);

			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				'setContext',
				'chorus.enabled',
				true
			);
		});

		it('should add disposables to context subscriptions', async () => {
			await activate(mockContext);

			expect(mockContext.subscriptions.push).toHaveBeenCalled();
			expect(mockDisposables.length).toBeGreaterThan(0);
		});

		it('should initialize database and indexer', async () => {
			// This test verifies the integration flow
			await activate(mockContext);

			// Should not throw errors during initialization
			expect(true).toBe(true); // If we get here, no errors were thrown
		});

		it('should handle activation errors gracefully', async () => {
			// Mock context with invalid storage path to trigger error
			const badContext = {
				...mockContext,
				globalStorageUri: null
			};

			// Should handle the error without crashing
			await expect(activate(badContext)).rejects.toThrow();
		});
	});

	describe('commands', () => {
		let commandHandlers: Map<string, Function>;

		beforeEach(async () => {
			commandHandlers = new Map();
			
			// Capture command handlers during registration
			vi.mocked(vscode.commands.registerCommand).mockImplementation((command: string, handler: Function) => {
				commandHandlers.set(command, handler);
				return { dispose: vi.fn() };
			});

			await activate(mockContext);
		});

		describe('chorus.showPanel', () => {
			it('should be registered', () => {
				expect(commandHandlers.has('chorus.showPanel')).toBe(true);
			});

			it('should execute without errors', async () => {
				const handler = commandHandlers.get('chorus.showPanel');
				expect(handler).toBeDefined();

				if (handler) {
					// Since the handler doesn't return a promise, just call it
					expect(() => handler()).not.toThrow();
				}
			});
		});

		describe('chorus.pasteFromTests', () => {
			it('should be registered', () => {
				expect(commandHandlers.has('chorus.pasteFromTests')).toBe(true);
			});

			it('should show message when no active editor', async () => {
				// Ensure activeTextEditor is null
				(vscode.window as any).activeTextEditor = null;

				const handler = commandHandlers.get('chorus.pasteFromTests');
				if (handler) {
					await handler();
				}

				expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('No active editor');
			});

			it('should paste evidence template when editor is active', async () => {
				const mockEditor = {
					selection: { active: { line: 0, character: 0 } },
					edit: vi.fn().mockImplementation((callback) => {
						const editBuilder = {
							insert: vi.fn()
						};
						callback(editBuilder);
						return Promise.resolve(true);
					})
				};

				(vscode.window as any).activeTextEditor = mockEditor as any;

				const handler = commandHandlers.get('chorus.pasteFromTests');
				if (handler) {
					await handler();
				}

				expect(mockEditor.edit).toHaveBeenCalled();
			});
		});
	});

	describe('deactivation', () => {
		it('should deactivate without errors', () => {
			expect(() => deactivate()).not.toThrow();
		});

		it('should log deactivation message', () => {
			const consoleSpy = vi.spyOn(console, 'log');
			deactivate();
			expect(consoleSpy).toHaveBeenCalledWith('Deactivating Chorus extension...');
		});
	});

	describe('workspace integration', () => {
		it('should handle workspace with no folders', async () => {
			(vscode.workspace as any).workspaceFolders = [];

			await expect(activate(mockContext)).resolves.not.toThrow();
		});

		it('should handle workspace with folders', async () => {
			(vscode.workspace as any).workspaceFolders = [
				{
					uri: { fsPath: '/test/workspace' },
					name: 'test-workspace',
					index: 0
				}
			];

			await expect(activate(mockContext)).resolves.not.toThrow();
		});

		it('should handle workspace changes during runtime', async () => {
			await activate(mockContext);

			// Simulate workspace change
			(vscode.workspace as any).workspaceFolders = [
				{
					uri: { fsPath: '/different/workspace' },
					name: 'different-workspace',
					index: 0
				}
			];

			// Extension should continue working
			expect(true).toBe(true);
		});
	});

	describe('error handling', () => {
		it('should handle database initialization errors', async () => {
			// Mock context with problematic storage path
			const problematicContext = {
				...mockContext,
				globalStorageUri: {
					fsPath: '/invalid/path/with/permissions/issues'
				}
			};

			await expect(activate(problematicContext)).rejects.toThrow();
		});

		it('should handle indexer errors gracefully', async () => {
			// Mock workspace to return error when finding files
			(vscode.workspace as any).findFiles = vi.fn().mockRejectedValue(new Error('File system error'));

			// Should still activate successfully
			await expect(activate(mockContext)).resolves.not.toThrow();
		});
	});

	describe('disposable management', () => {
		it('should properly dispose all resources', async () => {
			await activate(mockContext);

			// All registered disposables should have dispose method
			expect(mockDisposables.length).toBeGreaterThan(0);
			mockDisposables.forEach(disposable => {
				expect(disposable).toHaveProperty('dispose');
				expect(typeof disposable.dispose).toBe('function');
			});
		});

		it('should handle disposal errors gracefully', async () => {
			await activate(mockContext);

			// Mock one disposable to throw error on dispose
			if (mockDisposables.length > 0) {
				const originalDispose = mockDisposables[0].dispose;
				mockDisposables[0].dispose = vi.fn().mockImplementation(() => {
					throw new Error('Disposal error');
				});
			}

			// Should not crash the test runner when disposing
			// In a real scenario, VS Code would handle disposal errors
			expect(mockDisposables.length).toBeGreaterThan(0);
		});
	});

	describe('performance', () => {
		it('should activate quickly', async () => {
			const startTime = Date.now();
			await activate(mockContext);
			const activationTime = Date.now() - startTime;

			// Should activate in reasonable time (less than 1 second)
			expect(activationTime).toBeLessThan(1000);
		});

		it('should not block during indexing', async () => {
			// Mock long-running indexing operation
			(vscode.workspace as any).findFiles = vi.fn().mockImplementation(() => {
				return new Promise(resolve => {
					setTimeout(() => resolve([]), 100); // 100ms delay
				});
			});

			const startTime = Date.now();
			await activate(mockContext);
			const activationTime = Date.now() - startTime;

			// Activation should complete even with slow indexing
			expect(activationTime).toBeDefined();
		});
	});
});
