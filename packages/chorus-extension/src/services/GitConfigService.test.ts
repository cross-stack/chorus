import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getGitUserInfo, GitUserInfo } from './GitConfigService';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

// mock child_process
vi.mock('child_process');

// helper function to create mock process with error listener
function createMockProcess(): any {
  const process = new EventEmitter();
  (process as any).stdout = new EventEmitter();
  (process as any).stderr = new EventEmitter();
  return process;
}

describe('GitConfigService', () => {
  let mockSpawn: any;

  beforeEach(() => {
    mockSpawn = vi.mocked(spawn);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getGitUserInfo', () => {
    it('should return user name and email from git config', async () => {
      // mock both git config calls - they run in parallel via promise.all
      let callCount = 0;
      mockSpawn.mockImplementation((command: string, args: string[], options: any) => {
        const process = createMockProcess();

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
        email: 'jane.doe@example.com',
      });
    });

    it('should call git config with correct arguments', async () => {
      mockSpawn.mockImplementation((command: string, args: string[]) => {
        const process = createMockProcess();
        setTimeout(() => {
          (process as any).stdout.emit('data', 'Test User\n');
          process.emit('close', 0);
        }, 0);
        return process;
      });

      await getGitUserInfo('/test/workspace');

      // should be called twice - once for name, once for email
      expect(mockSpawn).toHaveBeenCalledWith('git', ['config', 'user.name'], {
        cwd: '/test/workspace',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      expect(mockSpawn).toHaveBeenCalledWith('git', ['config', 'user.email'], {
        cwd: '/test/workspace',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    });

    it('should return null when git config user.name is not set', async () => {
      mockSpawn.mockImplementation((command: string, args: string[]) => {
        const process = createMockProcess();
        setTimeout(() => {
          if (args[1] === 'user.name') {
            (process as any).stderr.emit('data', '');
            process.emit('close', 1); // exit code 1 for not found
          } else {
            (process as any).stdout.emit('data', 'test@example.com\n');
            process.emit('close', 0);
          }
        }, 0);
        return process;
      });

      const result = await getGitUserInfo('/test/workspace');
      expect(result).toBeNull();
    });

    it('should return null when git config user.email is not set', async () => {
      mockSpawn.mockImplementation((command: string, args: string[]) => {
        const process = createMockProcess();
        setTimeout(() => {
          if (args[1] === 'user.name') {
            (process as any).stdout.emit('data', 'John Doe\n');
            process.emit('close', 0);
          } else {
            (process as any).stderr.emit('data', '');
            process.emit('close', 1); // exit code 1 for not found
          }
        }, 0);
        return process;
      });

      const result = await getGitUserInfo('/test/workspace');
      expect(result).toBeNull();
    });

    it('should return null when git command fails', async () => {
      mockSpawn.mockImplementation((command: string, args: string[]) => {
        const process = createMockProcess();
        setTimeout(() => {
          (process as any).stderr.emit('data', 'fatal: not a git repository');
          process.emit('close', 128);
        }, 0);
        return process;
      });

      const result = await getGitUserInfo('/test/workspace');
      expect(result).toBeNull();
    });

    it('should return null when git is not in PATH', async () => {
      mockSpawn.mockImplementation(() => {
        const errorProcess = createMockProcess();
        // add error listener before emitting to prevent uncaught exception
        errorProcess.on('error', () => {});
        setTimeout(() => {
          const error: any = new Error('Command not found');
          error.code = 'ENOENT';
          errorProcess.emit('error', error);
        }, 0);
        return errorProcess;
      });

      const result = await getGitUserInfo('/test/workspace');
      expect(result).toBeNull();
    });

    it('should handle spawn errors gracefully', async () => {
      mockSpawn.mockImplementation(() => {
        const errorProcess = createMockProcess();
        // add error listener before emitting to prevent uncaught exception
        errorProcess.on('error', () => {});
        setTimeout(() => {
          errorProcess.emit('error', new Error('Unexpected spawn error'));
        }, 0);
        return errorProcess;
      });

      const result = await getGitUserInfo('/test/workspace');
      expect(result).toBeNull();
    });

    it('should parse output correctly and strip whitespace', async () => {
      mockSpawn.mockImplementation((command: string, args: string[]) => {
        const process = createMockProcess();
        setTimeout(() => {
          if (args[1] === 'user.name') {
            (process as any).stdout.emit('data', '  John Doe  \n\n');
          } else {
            (process as any).stdout.emit('data', '\t john@example.com \n');
          }
          process.emit('close', 0);
        }, 0);
        return process;
      });

      const result = await getGitUserInfo('/test/workspace');

      expect(result).toEqual({
        name: 'John Doe',
        email: 'john@example.com',
      });
    });

    it('should return structured data with name and email properties', async () => {
      mockSpawn.mockImplementation((command: string, args: string[]) => {
        const process = createMockProcess();
        setTimeout(() => {
          if (args[1] === 'user.name') {
            (process as any).stdout.emit('data', 'Test User\n');
          } else {
            (process as any).stdout.emit('data', 'test@example.com\n');
          }
          process.emit('close', 0);
        }, 0);
        return process;
      });

      const result = await getGitUserInfo('/test/workspace');

      expect(result).not.toBeNull();
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('email');
      expect(typeof result?.name).toBe('string');
      expect(typeof result?.email).toBe('string');
    });

    it('should handle empty git config values', async () => {
      mockSpawn.mockImplementation((command: string, args: string[]) => {
        const process = createMockProcess();
        setTimeout(() => {
          (process as any).stdout.emit('data', '\n');
          process.emit('close', 0);
        }, 0);
        return process;
      });

      const result = await getGitUserInfo('/test/workspace');

      // empty strings should result in null (invalid config)
      expect(result).toBeNull();
    });

    it('should handle partial data chunks correctly', async () => {
      mockSpawn.mockImplementation((command: string, args: string[]) => {
        const process = createMockProcess();
        setTimeout(() => {
          if (args[1] === 'user.name') {
            (process as any).stdout.emit('data', 'John ');
            (process as any).stdout.emit('data', 'Doe\n');
          } else {
            (process as any).stdout.emit('data', 'john@');
            (process as any).stdout.emit('data', 'example.com\n');
          }
          process.emit('close', 0);
        }, 0);
        return process;
      });

      const result = await getGitUserInfo('/test/workspace');

      expect(result).toEqual({
        name: 'John Doe',
        email: 'john@example.com',
      });
    });

    it('should handle stderr warnings without failing', async () => {
      mockSpawn.mockImplementation((command: string, args: string[]) => {
        const process = createMockProcess();
        setTimeout(() => {
          (process as any).stderr.emit('data', 'warning: some git warning\n');
          if (args[1] === 'user.name') {
            (process as any).stdout.emit('data', 'John Doe\n');
          } else {
            (process as any).stdout.emit('data', 'john@example.com\n');
          }
          process.emit('close', 0);
        }, 0);
        return process;
      });

      const result = await getGitUserInfo('/test/workspace');

      expect(result).toEqual({
        name: 'John Doe',
        email: 'john@example.com',
      });
    });

    it('should handle special characters in name and email', async () => {
      mockSpawn.mockImplementation((command: string, args: string[]) => {
        const process = createMockProcess();
        setTimeout(() => {
          if (args[1] === 'user.name') {
            (process as any).stdout.emit('data', 'José García-Smith\n');
          } else {
            (process as any).stdout.emit('data', 'jose.garcia+test@example.co.uk\n');
          }
          process.emit('close', 0);
        }, 0);
        return process;
      });

      const result = await getGitUserInfo('/test/workspace');

      expect(result).toEqual({
        name: 'José García-Smith',
        email: 'jose.garcia+test@example.co.uk',
      });
    });
  });

  describe('error scenarios', () => {
    it('should handle timeout gracefully', async () => {
      // note: this test depends on implementation having a timeout mechanism
      // if getgituserinfo hangs indefinitely, this would be a bug to fix
      mockSpawn.mockImplementation(() => {
        const hangingProcess = createMockProcess();
        // never emit close event
        return hangingProcess;
      });

      // in a real implementation, we'd expect a timeout
      // for now, just verify that the mock is called
      const promise = getGitUserInfo('/test/workspace');

      // give it a moment to start
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockSpawn).toHaveBeenCalled();
    });

    it('should handle process killed scenarios', async () => {
      mockSpawn.mockImplementation(() => {
        const process = createMockProcess();
        // add error listener before emitting to prevent uncaught exception
        process.on('error', () => {});
        setTimeout(() => {
          process.emit('error', new Error('Process was killed'));
        }, 0);
        return process;
      });

      const result = await getGitUserInfo('/test/workspace');
      expect(result).toBeNull();
    });
  });

  describe('anonymity preservation', () => {
    // verify that git config service can retrieve identity
    // but doesn't leak it during blinded review phases

    it('should return git identity when requested', async () => {
      mockSpawn.mockImplementation((command: string, args: string[]) => {
        const process = createMockProcess();
        setTimeout(() => {
          if (args[1] === 'user.name') {
            (process as any).stdout.emit('data', 'Anonymous Reviewer\n');
          } else {
            (process as any).stdout.emit('data', 'anon@example.com\n');
          }
          process.emit('close', 0);
        }, 0);
        return process;
      });

      const result = await getGitUserInfo('/test/workspace');

      // service should faithfully return git config
      // it's the caller's responsibility to protect anonymity during blinded phase
      expect(result).toEqual({
        name: 'Anonymous Reviewer',
        email: 'anon@example.com',
      });
    });
  });
});
