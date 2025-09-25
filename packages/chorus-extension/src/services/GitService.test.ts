import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { simpleGitLog, getCurrentBranch, GitLogEntry } from './GitService';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

// Mock child_process
vi.mock('child_process');

describe('GitService', () => {
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

	describe('simpleGitLog', () => {
		it('should parse git log output correctly', async () => {
			const mockOutput = `abc123|John Doe|2023-01-01 12:00:00|feat: add authentication
src/auth.ts
src/types.ts

def456|Jane Smith|2023-01-02 15:30:00|fix: resolve login bug
src/login.ts`;

			// Create promise and resolve it after setting up the mock
			const promise = simpleGitLog('/test/workspace', 10);
			
			// Simulate successful git command
			setTimeout(() => {
				mockProcess.stdout.emit('data', mockOutput);
				mockProcess.emit('close', 0);
			}, 0);

			const result = await promise;

			expect(result).toHaveLength(2);
			
			expect(result[0]).toEqual({
				hash: 'abc123',
				author: 'John Doe',
				date: '2023-01-01 12:00:00',
				subject: 'feat: add authentication',
				body: '',
				files: ['src/auth.ts', 'src/types.ts']
			});

			expect(result[1]).toEqual({
				hash: 'def456',
				author: 'Jane Smith',
				date: '2023-01-02 15:30:00',
				subject: 'fix: resolve login bug',
				body: '',
				files: ['src/login.ts']
			});
		});

		it('should call git with correct arguments', async () => {
			const promise = simpleGitLog('/test/workspace', 50);
			
			setTimeout(() => {
				mockProcess.stdout.emit('data', '');
				mockProcess.emit('close', 0);
			}, 0);

			await promise;

			expect(mockSpawn).toHaveBeenCalledWith('git', [
				'log',
				'--oneline',
				'--pretty=format:%H|%an|%ad|%s',
				'--date=iso',
				'--name-only',
				'-50'
			], {
				cwd: '/test/workspace',
				stdio: ['pipe', 'pipe', 'pipe']
			});
		});

		it('should use default limit when not specified', async () => {
			const promise = simpleGitLog('/test/workspace');
			
			setTimeout(() => {
				mockProcess.stdout.emit('data', '');
				mockProcess.emit('close', 0);
			}, 0);

			await promise;

			expect(mockSpawn).toHaveBeenCalledWith('git', 
				expect.arrayContaining(['-50']), 
				expect.any(Object)
			);
		});

		it('should handle git command failures', async () => {
			const promise = simpleGitLog('/test/workspace', 10);
			
			setTimeout(() => {
				mockProcess.stderr.emit('data', 'fatal: not a git repository');
				mockProcess.emit('close', 128);
			}, 0);

			await expect(promise).rejects.toThrow('Git command failed: fatal: not a git repository');
		});

		it('should handle spawn errors', async () => {
			mockSpawn.mockImplementation(() => {
				const errorProcess = new EventEmitter();
				setTimeout(() => errorProcess.emit('error', new Error('Command not found')), 0);
				return errorProcess;
			});

			await expect(simpleGitLog('/test/workspace', 10))
				.rejects
				.toThrow('Failed to spawn git process: Command not found');
		});

		it('should handle empty git log output', async () => {
			const promise = simpleGitLog('/test/workspace', 10);
			
			setTimeout(() => {
				mockProcess.stdout.emit('data', '');
				mockProcess.emit('close', 0);
			}, 0);

			const result = await promise;
			expect(result).toHaveLength(0);
		});

		it('should handle malformed git log entries', async () => {
			const mockOutput = `malformed line without pipes
abc123|John Doe|2023-01-01|good entry
another malformed line`;

			const promise = simpleGitLog('/test/workspace', 10);
			
			setTimeout(() => {
				mockProcess.stdout.emit('data', mockOutput);
				mockProcess.emit('close', 0);
			}, 0);

			const result = await promise;
			expect(result).toHaveLength(1);
			expect(result[0].hash).toBe('abc123');
		});

		it('should handle entries with no files', async () => {
			const mockOutput = `abc123|John Doe|2023-01-01 12:00:00|empty commit`;

			const promise = simpleGitLog('/test/workspace', 10);
			
			setTimeout(() => {
				mockProcess.stdout.emit('data', mockOutput);
				mockProcess.emit('close', 0);
			}, 0);

			const result = await promise;
			expect(result).toHaveLength(1);
			expect(result[0].files).toEqual([]);
		});

		it('should trim whitespace from files', async () => {
			const mockOutput = `abc123|John Doe|2023-01-01 12:00:00|commit with files
  src/file1.ts  
	src/file2.ts	`;

			const promise = simpleGitLog('/test/workspace', 10);
			
			setTimeout(() => {
				mockProcess.stdout.emit('data', mockOutput);
				mockProcess.emit('close', 0);
			}, 0);

			const result = await promise;
			expect(result[0].files).toEqual(['src/file1.ts', 'src/file2.ts']);
		});
	});

	describe('getCurrentBranch', () => {
		it('should return current branch name', async () => {
			const promise = getCurrentBranch('/test/workspace');
			
			setTimeout(() => {
				mockProcess.stdout.emit('data', 'feature/new-feature\n');
				mockProcess.emit('close', 0);
			}, 0);

			const result = await promise;
			expect(result).toBe('feature/new-feature');
		});

		it('should call git with correct arguments', async () => {
			const promise = getCurrentBranch('/test/workspace');
			
			setTimeout(() => {
				mockProcess.stdout.emit('data', 'main');
				mockProcess.emit('close', 0);
			}, 0);

			await promise;

			expect(mockSpawn).toHaveBeenCalledWith('git', ['branch', '--show-current'], {
				cwd: '/test/workspace',
				stdio: ['pipe', 'pipe', 'pipe']
			});
		});

		it('should handle git command failures', async () => {
			const promise = getCurrentBranch('/test/workspace');
			
			setTimeout(() => {
				mockProcess.stderr.emit('data', 'fatal: not a git repository');
				mockProcess.emit('close', 128);
			}, 0);

			await expect(promise).rejects.toThrow('Git command failed: fatal: not a git repository');
		});

		it('should handle spawn errors', async () => {
			mockSpawn.mockImplementation(() => {
				const errorProcess = new EventEmitter();
				setTimeout(() => errorProcess.emit('error', new Error('Command not found')), 0);
				return errorProcess;
			});

			await expect(getCurrentBranch('/test/workspace'))
				.rejects
				.toThrow('Failed to spawn git process: Command not found');
		});

		it('should trim whitespace from branch name', async () => {
			const promise = getCurrentBranch('/test/workspace');
			
			setTimeout(() => {
				mockProcess.stdout.emit('data', '  main  \n');
				mockProcess.emit('close', 0);
			}, 0);

			const result = await promise;
			expect(result).toBe('main');
		});

		it('should handle empty output', async () => {
			const promise = getCurrentBranch('/test/workspace');
			
			setTimeout(() => {
				mockProcess.stdout.emit('data', '');
				mockProcess.emit('close', 0);
			}, 0);

			const result = await promise;
			expect(result).toBe('');
		});
	});

	describe('parseGitLog function', () => {
		it('should handle commits with body text between entries', async () => {
			const mockOutput = `abc123|John Doe|2023-01-01 12:00:00|feat: add feature
src/file1.ts
src/file2.ts

def456|Jane Smith|2023-01-02 15:30:00|fix: bug fix
src/file3.ts`;

			const promise = simpleGitLog('/test/workspace', 10);
			
			setTimeout(() => {
				mockProcess.stdout.emit('data', mockOutput);
				mockProcess.emit('close', 0);
			}, 0);

			const result = await promise;
			expect(result).toHaveLength(2);
			expect(result[0].files).toEqual(['src/file1.ts', 'src/file2.ts']);
			expect(result[1].files).toEqual(['src/file3.ts']);
		});
	});

	describe('error scenarios', () => {
		it('should handle partial data chunks', async () => {
			const firstChunk = 'abc123|John Doe|2023-01-01 12:';
			const secondChunk = '00:00|commit message\nsrc/file.ts';

			const promise = simpleGitLog('/test/workspace', 10);
			
			setTimeout(() => {
				mockProcess.stdout.emit('data', firstChunk);
				mockProcess.stdout.emit('data', secondChunk);
				mockProcess.emit('close', 0);
			}, 0);

			const result = await promise;
			expect(result).toHaveLength(1);
			expect(result[0].hash).toBe('abc123');
			expect(result[0].files).toEqual(['src/file.ts']);
		});

		it('should handle stderr data without immediate failure', async () => {
			const promise = simpleGitLog('/test/workspace', 10);
			
			setTimeout(() => {
				mockProcess.stderr.emit('data', 'warning: some warning\n');
				mockProcess.stdout.emit('data', 'abc123|John|2023-01-01|commit\n');
				mockProcess.emit('close', 0); // Success despite stderr
			}, 0);

			const result = await promise;
			expect(result).toHaveLength(1);
		});
	});
});
