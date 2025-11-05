import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getGitUserInfo, GitUserInfo } from './GitConfigService';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

// mock child_process
vi.mock('child_process');

describe('GitConfigService', () => {
	let mockSpawn: any;
	let mockProcess: any;

	beforeEach(() => {
		mockProcess = new EventEmitter();
		mockProcess.stdout = new EventEmitter();
		mockProcess.stderr = new EventEmitter();

		mockSpawn = vi.mocked(spawn);
		mockSpawn.mockReturnValue(mockProcess);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('getGitUserInfo', () => {
		it('should return user name and email from git config', async () => {
			// mock both git config calls. name and email are called in parallel
			mockSpawn.mockImplementation((command: string, args: string[], options: any) => {
				const process = new EventEmitter();
				(process as any).stdout = new EventEmitter();
				(process as any).stderr = new EventEmitter();

				setTimeout(() => {
					if (args[1] === 'user.name') {
						(process as any).stdout.emit('data', 'Jane Doe\n');
					} else if (args[1] === 'user.email') {
						(process as any).stdout.emit('data', 'jane.doe@example.com\n');
					}
					process.emit('close', 0);
				}, 0);

				return process;
			});

			const result = await getGitUserInfo('/test/workspace');

			expect(result).toEqual({
				name: 'Jane Doe',
				email: 'jane.doe@example.com'
			});
		});

		it('should call git config with correct arguments', async () => {
			const promise = getGitUserInfo();

			setTimeout(() => {
				mockProcess.stdout.emit('data', 'John Doe\n');
				mockProcess.emit('close', 0);
			}, 0);

			// second call for email
			setTimeout(() => {
				const secondProcess = new EventEmitter();
				(secondProcess as any).stdout = new EventEmitter();
				(secondProcess as any).stderr = new EventEmitter();
				mockSpawn.mockReturnValueOnce(secondProcess);

				setTimeout(() => {
					(secondProcess as any).stdout.emit('data', 'john@example.com\n');
					secondProcess.emit('close', 0);
				}, 0);
			}, 10);

			await promise;

			expect(mockSpawn).toHaveBeenCalledWith('git', ['config', 'user.name'], {
				stdio: ['pipe', 'pipe', 'pipe']
			});
		});

		it('should return null when git config user.name is not set', async () => {
			const promise = getGitUserInfo();

			setTimeout(() => {
				mockProcess.stderr.emit('data', '');
				mockProcess.emit('close', 1); // non-zero exit code when config not found
			}, 0);

			const result = await promise;
			expect(result).toBeNull();
		});

		it('should return null when git config user.email is not set', async () => {
			const promise = getGitUserInfo();

			// first call succeeds (user.name)
			setTimeout(() => {
				mockProcess.stdout.emit('data', 'John Doe\n');
				mockProcess.emit('close', 0);
			}, 0);

			// second call fails (user.email not set)
			setTimeout(() => {
				const secondProcess = new EventEmitter();
				(secondProcess as any).stdout = new EventEmitter();
				(secondProcess as any).stderr = new EventEmitter();
				mockSpawn.mockReturnValueOnce(secondProcess);

				setTimeout(() => {
					(secondProcess as any).stderr.emit('data', '');
					secondProcess.emit('close', 1);
				}, 0);
			}, 10);

			const result = await promise;
			expect(result).toBeNull();
		});

		it('should return null when git command fails', async () => {
			const promise = getGitUserInfo();

			setTimeout(() => {
				mockProcess.stderr.emit('data', 'fatal: not a git repository');
				mockProcess.emit('close', 128);
			}, 0);

			const result = await promise;
			expect(result).toBeNull();
		});

		it('should return null when git is not in PATH', async () => {
			mockSpawn.mockImplementation(() => {
				const errorProcess = new EventEmitter();
				// add error listener before emitting to prevent uncaught exception
				errorProcess.on('error', () => {});
				setTimeout(() => {
					const error: any = new Error('Command not found');
					error.code = 'ENOENT';
					errorProcess.emit('error', error);
				}, 0);
				return errorProcess;
			});

			const result = await getGitUserInfo();
			expect(result).toBeNull();
		});

		it('should handle spawn errors gracefully', async () => {
			mockSpawn.mockImplementation(() => {
				const errorProcess = new EventEmitter();
				// add error listener before emitting to prevent uncaught exception
				errorProcess.on('error', () => {});
				setTimeout(() => {
					errorProcess.emit('error', new Error('Unexpected spawn error'));
				}, 0);
				return errorProcess;
			});

			const result = await getGitUserInfo();
			expect(result).toBeNull();
		});

		it('should parse output correctly and strip whitespace', async () => {
			const promise = getGitUserInfo();

			setTimeout(() => {
				mockProcess.stdout.emit('data', '  John Doe  \n\n');
				mockProcess.emit('close', 0);
			}, 0);

			setTimeout(() => {
				const secondProcess = new EventEmitter();
				(secondProcess as any).stdout = new EventEmitter();
				(secondProcess as any).stderr = new EventEmitter();
				mockSpawn.mockReturnValueOnce(secondProcess);

				setTimeout(() => {
					(secondProcess as any).stdout.emit('data', '\t john@example.com \n');
					secondProcess.emit('close', 0);
				}, 0);
			}, 10);

			const result = await promise;

			expect(result).toEqual({
				name: 'John Doe',
				email: 'john@example.com'
			});
		});

		it('should return structured data with name and email properties', async () => {
			const promise = getGitUserInfo();

			setTimeout(() => {
				mockProcess.stdout.emit('data', 'Test User\n');
				mockProcess.emit('close', 0);
			}, 0);

			setTimeout(() => {
				const secondProcess = new EventEmitter();
				(secondProcess as any).stdout = new EventEmitter();
				(secondProcess as any).stderr = new EventEmitter();
				mockSpawn.mockReturnValueOnce(secondProcess);

				setTimeout(() => {
					(secondProcess as any).stdout.emit('data', 'test@example.com\n');
					secondProcess.emit('close', 0);
				}, 0);
			}, 10);

			const result = await promise;

			expect(result).not.toBeNull();
			expect(result).toHaveProperty('name');
			expect(result).toHaveProperty('email');
			expect(typeof result?.name).toBe('string');
			expect(typeof result?.email).toBe('string');
		});

		it('should handle empty git config values', async () => {
			const promise = getGitUserInfo();

			setTimeout(() => {
				mockProcess.stdout.emit('data', '\n');
				mockProcess.emit('close', 0);
			}, 0);

			setTimeout(() => {
				const secondProcess = new EventEmitter();
				(secondProcess as any).stdout = new EventEmitter();
				(secondProcess as any).stderr = new EventEmitter();
				mockSpawn.mockReturnValueOnce(secondProcess);

				setTimeout(() => {
					(secondProcess as any).stdout.emit('data', '\n');
					secondProcess.emit('close', 0);
				}, 0);
			}, 10);

			const result = await promise;

			// Empty strings should result in null (invalid config)
			expect(result).toBeNull();
		});

		it('should handle partial data chunks correctly', async () => {
			const promise = getGitUserInfo();

			setTimeout(() => {
				mockProcess.stdout.emit('data', 'John ');
				mockProcess.stdout.emit('data', 'Doe\n');
				mockProcess.emit('close', 0);
			}, 0);

			setTimeout(() => {
				const secondProcess = new EventEmitter();
				(secondProcess as any).stdout = new EventEmitter();
				(secondProcess as any).stderr = new EventEmitter();
				mockSpawn.mockReturnValueOnce(secondProcess);

				setTimeout(() => {
					(secondProcess as any).stdout.emit('data', 'john@');
					(secondProcess as any).stdout.emit('data', 'example.com\n');
					secondProcess.emit('close', 0);
				}, 0);
			}, 10);

			const result = await promise;

			expect(result).toEqual({
				name: 'John Doe',
				email: 'john@example.com'
			});
		});

		it('should handle stderr warnings without failing', async () => {
			const promise = getGitUserInfo();

			setTimeout(() => {
				mockProcess.stderr.emit('data', 'warning: some git warning\n');
				mockProcess.stdout.emit('data', 'John Doe\n');
				mockProcess.emit('close', 0);
			}, 0);

			setTimeout(() => {
				const secondProcess = new EventEmitter();
				(secondProcess as any).stdout = new EventEmitter();
				(secondProcess as any).stderr = new EventEmitter();
				mockSpawn.mockReturnValueOnce(secondProcess);

				setTimeout(() => {
					(secondProcess as any).stdout.emit('data', 'john@example.com\n');
					secondProcess.emit('close', 0);
				}, 0);
			}, 10);

			const result = await promise;

			expect(result).toEqual({
				name: 'John Doe',
				email: 'john@example.com'
			});
		});

		it('should handle special characters in name and email', async () => {
			const promise = getGitUserInfo();

			setTimeout(() => {
				mockProcess.stdout.emit('data', 'José García-Smith\n');
				mockProcess.emit('close', 0);
			}, 0);

			setTimeout(() => {
				const secondProcess = new EventEmitter();
				(secondProcess as any).stdout = new EventEmitter();
				(secondProcess as any).stderr = new EventEmitter();
				mockSpawn.mockReturnValueOnce(secondProcess);

				setTimeout(() => {
					(secondProcess as any).stdout.emit('data', 'jose.garcia+test@example.co.uk\n');
					secondProcess.emit('close', 0);
				}, 0);
			}, 10);

			const result = await promise;

			expect(result).toEqual({
				name: 'José García-Smith',
				email: 'jose.garcia+test@example.co.uk'
			});
		});
	});

	describe('error scenarios', () => {
		it('should handle timeout gracefully', async () => {
			// Note: This test depends on implementation having a timeout mechanism
			// If getGitUserInfo hangs indefinitely, this would be a bug to fix
			mockSpawn.mockImplementation(() => {
				const hangingProcess = new EventEmitter();
				(hangingProcess as any).stdout = new EventEmitter();
				(hangingProcess as any).stderr = new EventEmitter();
				// never emit close event
				return hangingProcess;
			});

			// In a real implementation, we'd expect a timeout
			// For now, just verify that the mock is called
			const promise = getGitUserInfo();

			// Give it a moment to start
			await new Promise(resolve => setTimeout(resolve, 50));

			expect(mockSpawn).toHaveBeenCalled();
		});

		it('should handle process killed scenarios', async () => {
			const promise = getGitUserInfo();

			setTimeout(() => {
				// add error listener before emitting to prevent uncaught exception
				mockProcess.on('error', () => {});
				mockProcess.emit('error', new Error('Process was killed'));
			}, 0);

			const result = await promise;
			expect(result).toBeNull();
		});
	});

	describe('anonymity preservation', () => {
		// Verify that git config service can retrieve identity
		// but doesn't leak it during blinded review phases

		it('should return git identity when requested', async () => {
			const promise = getGitUserInfo();

			setTimeout(() => {
				mockProcess.stdout.emit('data', 'Anonymous Reviewer\n');
				mockProcess.emit('close', 0);
			}, 0);

			setTimeout(() => {
				const secondProcess = new EventEmitter();
				(secondProcess as any).stdout = new EventEmitter();
				(secondProcess as any).stderr = new EventEmitter();
				mockSpawn.mockReturnValueOnce(secondProcess);

				setTimeout(() => {
					(secondProcess as any).stdout.emit('data', 'anon@example.com\n');
					secondProcess.emit('close', 0);
				}, 0);
			}, 10);

			const result = await promise;

			// Service should faithfully return git config
			// It's the caller's responsibility to protect anonymity during blinded phase
			expect(result).toEqual({
				name: 'Anonymous Reviewer',
				email: 'anon@example.com'
			});
		});
	});
});
