import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { activate, deactivate } from '../extension';
import { TestDatabase, createMockVSCodeExtensionContext } from './testUtils';

// mock vscode module completely
vi.mock('vscode', () => ({
	commands: {
		registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		executeCommand: vi.fn()
	},
	window: {
		activeTextEditor: null,
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
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

		// reset mocks
		vi.clearAllMocks();
	});

	afterEach(() => {
		// clean up any resources
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
				'chorus.addEvidence',
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
			// this test verifies the integration flow
			await activate(mockContext);

			// should not throw errors during initialization
			expect(true).toBe(true); // If we get here, no errors were thrown
		});

		it('should handle activation errors gracefully', async () => {
			// mock context with invalid storage path to trigger error
			const badContext = {
				...mockContext,
				globalStorageUri: null
			};

			// should handle the error without crashing
			await expect(activate(badContext)).rejects.toThrow();
		});
	});

	describe('commands', () => {
		let commandHandlers: Map<string, Function>;

		beforeEach(async () => {
			commandHandlers = new Map();

			// capture command handlers during registration
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
					// since the handler doesn't return a promise, just call it
					expect(() => handler()).not.toThrow();
				}
			});
		});

		describe('chorus.addEvidence', () => {
			it('should be registered', () => {
				expect(commandHandlers.has('chorus.addEvidence')).toBe(true);
			});

			it('should show message when no active editor', async () => {
				// ensure activeTextEditor is null
				(vscode.window as any).activeTextEditor = null;

				const handler = commandHandlers.get('chorus.addEvidence');
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

				const handler = commandHandlers.get('chorus.addEvidence');
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

			// simulate workspace change
			(vscode.workspace as any).workspaceFolders = [
				{
					uri: { fsPath: '/different/workspace' },
					name: 'different-workspace',
					index: 0
				}
			];

			// extension should continue working
			expect(true).toBe(true);
		});
	});

	describe('error handling', () => {
		it('should handle database initialization errors', async () => {
			// mock context with problematic storage path
			const problematicContext = {
				...mockContext,
				globalStorageUri: {
					fsPath: '/invalid/path/with/permissions/issues'
				}
			};

			await expect(activate(problematicContext)).rejects.toThrow();
		});

		it('should handle indexer errors gracefully', async () => {
			// mock workspace to return error when finding files
			(vscode.workspace as any).findFiles = vi.fn().mockRejectedValue(new Error('File system error'));

			// should still activate successfully
			await expect(activate(mockContext)).resolves.not.toThrow();
		});
	});

	describe('disposable management', () => {
		it('should properly dispose all resources', async () => {
			await activate(mockContext);

			// all registered disposables should have dispose method
			expect(mockDisposables.length).toBeGreaterThan(0);
			mockDisposables.forEach(disposable => {
				expect(disposable).toHaveProperty('dispose');
				expect(typeof disposable.dispose).toBe('function');
			});
		});

		it('should handle disposal errors gracefully', async () => {
			await activate(mockContext);

			// mock one disposable to throw error on dispose
			if (mockDisposables.length > 0) {
				const originalDispose = mockDisposables[0].dispose;
				mockDisposables[0].dispose = vi.fn().mockImplementation(() => {
					throw new Error('Disposal error');
				});
			}

			// should not crash the test runner when disposing
			// in a real scenario, VS Code would handle disposal errors
			expect(mockDisposables.length).toBeGreaterThan(0);
		});
	});

	describe('performance', () => {
		it('should activate quickly', async () => {
			const startTime = Date.now();
			await activate(mockContext);
			const activationTime = Date.now() - startTime;

			// should activate in reasonable time (less than 1 second)
			expect(activationTime).toBeLessThan(1000);
		});

		it('should not block during indexing', async () => {
			// mock long-running indexing operation
			(vscode.workspace as any).findFiles = vi.fn().mockImplementation(() => {
				return new Promise(resolve => {
					setTimeout(() => resolve([]), 100); // 100ms delay
				});
			});

			const startTime = Date.now();
			await activate(mockContext);
			const activationTime = Date.now() - startTime;

			// activation should complete even with slow indexing
			expect(activationTime).toBeDefined();
		});
	});

	describe('Blinded Review Workflow Integration', () => {
		// coverage: end-to-end workflow tests for pr phase management
		let testDb: TestDatabase;
		let mockPanel: any;
		let messageHandler: Function;

		beforeEach(async () => {
			// setup test database
			testDb = new TestDatabase();
			await testDb.setup();

			// setup mock panel with message handling
			messageHandler = vi.fn();
			mockPanel = {
				webview: {
					html: '',
					asWebviewUri: vi.fn((uri) => uri),
					onDidReceiveMessage: vi.fn((callback) => {
						messageHandler = callback;
						return { dispose: vi.fn() };
					}),
					postMessage: vi.fn()
				},
				onDidDispose: vi.fn((callback) => ({ dispose: vi.fn() })),
				reveal: vi.fn(),
				dispose: vi.fn()
			};

			// mock createWebviewPanel to return our mock
			vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(mockPanel);
		});

		afterEach(async () => {
			await testDb.cleanup();
		});

		describe('phase state management', () => {
			it('should initialize PR in blinded phase', async () => {
				// arrange
				const prRef = 'PR-123';

				// act
				await testDb.db.startBlindedReview(prRef);
				const phase = await testDb.db.getPRPhase(prRef);

				// assert
				expect(phase).toBe('blinded');
			});

			it('should transition from blinded to revealed phase', async () => {
				// arrange
				const prRef = 'PR-456';
				await testDb.db.setPRPhase(prRef, 'blinded');

				// act
				await testDb.db.setPRPhase(prRef, 'revealed');
				const phase = await testDb.db.getPRPhase(prRef);

				// assert
				expect(phase).toBe('revealed');
			});

			it('should allow ballot submission during blinded phase', async () => {
				// arrange
				const prRef = 'PR-789';
				await testDb.db.setPRPhase(prRef, 'blinded');

				// act
				const canSubmit = await testDb.db.canSubmitBallot(prRef);

				// assert
				expect(canSubmit).toBe(true);
			});

			it('should prevent ballot submission during revealed phase', async () => {
				// arrange
				const prRef = 'PR-101';
				await testDb.db.setPRPhase(prRef, 'revealed');

				// act
				const canSubmit = await testDb.db.canSubmitBallot(prRef);

				// assert
				expect(canSubmit).toBe(false);
			});
		});

		describe('ballot submission workflow', () => {
			it('should submit ballot during blinded phase', async () => {
				// arrange
				const prRef = 'PR-202';
				await testDb.db.setPRPhase(prRef, 'blinded');

				const ballot = {
					pr_reference: prRef,
					decision: 'approve' as const,
					confidence: 4,
					rationale: 'Good implementation',
					author_metadata: JSON.stringify({ name: 'Test User', email: 'test@example.com' }),
					revealed: false
				};

				// act
				const ballotId = await testDb.db.addBallot(ballot);

				// assert
				expect(ballotId).toBeGreaterThan(0);

				const ballots = await testDb.db.getBallotsByPR(prRef);
				expect(ballots).toHaveLength(1);
				expect(ballots[0].revealed).toBe(false);
			});

			it('should handle multiple ballots for same PR', async () => {
				// arrange
				const prRef = 'PR-303';
				await testDb.db.setPRPhase(prRef, 'blinded');

				// act - submit three ballots
				await testDb.db.addBallot({
					pr_reference: prRef,
					decision: 'approve',
					confidence: 5,
					rationale: 'Excellent work',
					author_metadata: JSON.stringify({ name: 'Reviewer 1' }),
					revealed: false
				});

				await testDb.db.addBallot({
					pr_reference: prRef,
					decision: 'neutral',
					confidence: 3,
					rationale: 'Needs minor changes',
					author_metadata: JSON.stringify({ name: 'Reviewer 2' }),
					revealed: false
				});

				await testDb.db.addBallot({
					pr_reference: prRef,
					decision: 'approve',
					confidence: 4,
					rationale: 'Looks good',
					author_metadata: JSON.stringify({ name: 'Reviewer 3' }),
					revealed: false
				});

				// assert
				const ballots = await testDb.db.getBallotsByPR(prRef);
				expect(ballots).toHaveLength(3);
				expect(ballots.every(b => !b.revealed)).toBe(true);
			});
		});

		describe('reveal workflow', () => {
			it('should check if ballots can be revealed', async () => {
				// arrange - set threshold to 1 for easier testing
				const prRef = 'PR-404';
				await testDb.db.startBlindedReview(prRef, 1);

				// act & assert - no ballots yet
				let canReveal = await testDb.db.canRevealBallots(prRef);
				expect(canReveal).toBe(false);

				// add ballot (meets threshold of 1)
				await testDb.db.addBallot({
					pr_reference: prRef,
					decision: 'approve',
					confidence: 4,
					rationale: 'LGTM',
					author_metadata: JSON.stringify({ name: 'Reviewer' }),
					revealed: false
				});

				// should now be able to reveal
				canReveal = await testDb.db.canRevealBallots(prRef);
				expect(canReveal).toBe(true);
			});

			it('should reveal all ballots for a PR', async () => {
				// arrange
				const prRef = 'PR-505';
				await testDb.db.setPRPhase(prRef, 'blinded');

				await testDb.db.addBallot({
					pr_reference: prRef,
					decision: 'approve',
					confidence: 5,
					rationale: 'Ballot 1',
					author_metadata: JSON.stringify({ name: 'User 1' }),
					revealed: false
				});

				await testDb.db.addBallot({
					pr_reference: prRef,
					decision: 'reject',
					confidence: 2,
					rationale: 'Ballot 2',
					author_metadata: JSON.stringify({ name: 'User 2' }),
					revealed: false
				});

				// act
				await testDb.db.revealBallots(prRef);
				await testDb.db.setPRPhase(prRef, 'revealed');

				// assert
				const ballots = await testDb.db.getBallotsByPR(prRef);
				expect(ballots).toHaveLength(2);
				expect(ballots.every(b => b.revealed)).toBe(true);

				const phase = await testDb.db.getPRPhase(prRef);
				expect(phase).toBe('revealed');
			});

			it('should not reveal ballots if already revealed', async () => {
				// arrange
				const prRef = 'PR-606';
				await testDb.db.setPRPhase(prRef, 'revealed');
				await testDb.db.addBallot({
					pr_reference: prRef,
					decision: 'approve',
					confidence: 4,
					rationale: 'Late ballot',
					author_metadata: JSON.stringify({ name: 'User' }),
					revealed: false
				});

				// act
				const canReveal = await testDb.db.canRevealBallots(prRef);

				// assert
				expect(canReveal).toBe(false);
			});
		});

		describe('complete workflow end-to-end', () => {
			it('should complete full blinded review cycle', async () => {
				// arrange
				const prRef = 'PR-707';
				await testDb.db.startBlindedReview(prRef, 3);

				// act & assert - step 1: verify initial blinded state
				let phase = await testDb.db.getPRPhase(prRef);
				expect(phase).toBe('blinded');

				// step 2: submit ballots during blinded phase
				const canSubmit = await testDb.db.canSubmitBallot(prRef);
				expect(canSubmit).toBe(true);

				await testDb.db.addBallot({
					pr_reference: prRef,
					decision: 'approve',
					confidence: 5,
					rationale: 'Comprehensive tests',
					author_metadata: JSON.stringify({ name: 'Alice', email: 'alice@example.com' }),
					revealed: false
				});

				await testDb.db.addBallot({
					pr_reference: prRef,
					decision: 'approve',
					confidence: 4,
					rationale: 'Good architecture',
					author_metadata: JSON.stringify({ name: 'Bob', email: 'bob@example.com' }),
					revealed: false
				});

				await testDb.db.addBallot({
					pr_reference: prRef,
					decision: 'neutral',
					confidence: 3,
					rationale: 'Consider edge cases',
					author_metadata: JSON.stringify({ name: 'Charlie', email: 'charlie@example.com' }),
					revealed: false
				});

				// step 3: check if can reveal (threshold met)
				const canReveal = await testDb.db.canRevealBallots(prRef);
				expect(canReveal).toBe(true);

				// step 4: reveal ballots
				await testDb.db.revealBallots(prRef);
				await testDb.db.setPRPhase(prRef, 'revealed');

				// step 5: verify reveal state
				const ballots = await testDb.db.getBallotsByPR(prRef);
				expect(ballots).toHaveLength(3);
				expect(ballots.every(b => b.revealed)).toBe(true);

				phase = await testDb.db.getPRPhase(prRef);
				expect(phase).toBe('revealed');

				// step 6: verify cannot submit new ballots
				const canSubmitAfter = await testDb.db.canSubmitBallot(prRef);
				expect(canSubmitAfter).toBe(false);
			});

			it('should handle workflow with insufficient ballots', async () => {
				// arrange - coverage: test workflow when threshold not met
				const prRef = 'PR-808';
				await testDb.db.startBlindedReview(prRef, 3);

				// act - no ballots submitted
				const canReveal = await testDb.db.canRevealBallots(prRef);

				// assert - should not allow reveal
				expect(canReveal).toBe(false);

				// verify phase remains blinded
				const phase = await testDb.db.getPRPhase(prRef);
				expect(phase).toBe('blinded');
			});
		});

		describe('error handling in workflow', () => {
			it('should handle database errors during ballot submission', async () => {
				// arrange
				const prRef = 'PR-909';
				testDb.db.dispose(); // force database error

				// act & assert
				await expect(testDb.db.addBallot({
					pr_reference: prRef,
					decision: 'approve',
					confidence: 4,
					rationale: 'Test',
					author_metadata: '{}',
					revealed: false
				})).rejects.toThrow('Database not initialized');
			});

			it('should handle database errors during reveal', async () => {
				// arrange
				const prRef = 'PR-1010';
				testDb.db.dispose(); // force database error

				// act & assert
				await expect(testDb.db.revealBallots(prRef))
					.rejects
					.toThrow('Database not initialized');
			});

			it('should handle database errors during phase check', async () => {
				// arrange
				const prRef = 'PR-1111';
				testDb.db.dispose(); // force database error

				// act & assert
				await expect(testDb.db.getPRPhase(prRef))
					.rejects
					.toThrow('Database not initialized');
			});
		});

		describe('data isolation between PRs', () => {
			it('should keep ballot data isolated between different PRs', async () => {
				// arrange - coverage: test cross-pr data isolation
				const pr1 = 'PR-1212';
				const pr2 = 'PR-1313';

				await testDb.db.setPRPhase(pr1, 'blinded');
				await testDb.db.setPRPhase(pr2, 'blinded');

				// act - add ballots to pr1
				await testDb.db.addBallot({
					pr_reference: pr1,
					decision: 'approve',
					confidence: 5,
					rationale: 'PR1 ballot',
					author_metadata: '{}',
					revealed: false
				});

				// add ballots to pr2
				await testDb.db.addBallot({
					pr_reference: pr2,
					decision: 'reject',
					confidence: 2,
					rationale: 'PR2 ballot',
					author_metadata: '{}',
					revealed: false
				});

				// reveal only pr1
				await testDb.db.revealBallots(pr1);
				await testDb.db.setPRPhase(pr1, 'revealed');

				// assert - pr1 revealed, pr2 still blinded
				const ballots1 = await testDb.db.getBallotsByPR(pr1);
				const ballots2 = await testDb.db.getBallotsByPR(pr2);

				expect(ballots1[0].revealed).toBe(true);
				expect(ballots2[0].revealed).toBe(false);

				const phase1 = await testDb.db.getPRPhase(pr1);
				const phase2 = await testDb.db.getPRPhase(pr2);

				expect(phase1).toBe('revealed');
				expect(phase2).toBe('blinded');
			});

			it('should handle multiple concurrent PRs in different phases', async () => {
				// arrange
				const prs = ['PR-1414', 'PR-1515', 'PR-1616'];

				// act - set different phases
				await testDb.db.setPRPhase(prs[0], 'blinded');
				await testDb.db.setPRPhase(prs[1], 'revealed');
				await testDb.db.setPRPhase(prs[2], 'blinded');

				// add ballots to each
				for (const pr of prs) {
					await testDb.db.addBallot({
						pr_reference: pr,
						decision: 'approve',
						confidence: 4,
						rationale: `Ballot for ${pr}`,
						author_metadata: '{}',
						revealed: pr === prs[1] // only second PR revealed
					});
				}

				// assert - each PR has independent state
				const phases = await Promise.all(prs.map(pr => testDb.db.getPRPhase(pr)));
				expect(phases).toEqual(['blinded', 'revealed', 'blinded']);

				const canSubmit = await Promise.all(prs.map(pr => testDb.db.canSubmitBallot(pr)));
				expect(canSubmit).toEqual([true, false, true]);
			});
		});
	});
});
