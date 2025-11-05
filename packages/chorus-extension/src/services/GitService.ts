import { spawn } from 'child_process';

export interface GitLogEntry {
  hash: string;
  author: string;
  date: string;
  subject: string;
  body: string;
  files: string[];
}

export async function simpleGitLog(
  workspacePath: string,
  limit: number = 50
): Promise<GitLogEntry[]> {
  return new Promise((resolve, reject) => {
    const gitProcess = spawn(
      'git',
      [
        'log',
        '--oneline',
        '--pretty=format:%H|%an|%ad|%s',
        '--date=iso',
        '--name-only',
        '-' + limit.toString(),
      ],
      {
        cwd: workspacePath,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    let stdout = '';
    let stderr = '';

    gitProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    gitProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    gitProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('Git command failed: ' + stderr));
        return;
      }

      try {
        const entries = parseGitLog(stdout);
        resolve(entries);
      } catch (error) {
        reject(error);
      }
    });

    gitProcess.on('error', (error) => {
      reject(new Error('Failed to spawn git process: ' + error.message));
    });
  });
}

function parseGitLog(output: string): GitLogEntry[] {
  const entries: GitLogEntry[] = [];
  const lines = output.split('\n').filter((line) => line.trim().length > 0);

  let currentEntry: Partial<GitLogEntry> | null = null;

  for (const line of lines) {
    if (line.includes('|')) {
      // this is a commit header line
      if (currentEntry) {
        // finalize the previous entry
        entries.push(currentEntry as GitLogEntry);
      }

      const parts = line.split('|');
      if (parts.length >= 4) {
        currentEntry = {
          hash: parts[0],
          author: parts[1],
          date: parts[2],
          subject: parts[3],
          body: '',
          files: [],
        };
      }
    } else if (currentEntry) {
      // this is a file name
      if (line.trim() && !line.startsWith(' ')) {
        currentEntry.files = currentEntry.files || [];
        currentEntry.files.push(line.trim());
      }
    }
  }

  // don't forget the last entry
  if (currentEntry) {
    entries.push(currentEntry as GitLogEntry);
  }

  return entries;
}

export async function getCurrentBranch(workspacePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const gitProcess = spawn('git', ['branch', '--show-current'], {
      cwd: workspacePath,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    gitProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    gitProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    gitProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('Git command failed: ' + stderr));
        return;
      }

      resolve(stdout.trim());
    });

    gitProcess.on('error', (error) => {
      reject(new Error('Failed to spawn git process: ' + error.message));
    });
  });
}
