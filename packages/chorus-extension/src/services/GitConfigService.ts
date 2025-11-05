import { spawn } from 'child_process';

/**
 * Git user configuration information
 */
export interface GitUserInfo {
	name: string;
	email: string;
}

/**
 * Executes a git command and returns its stdout output.
 *
 * This is a shared utility to avoid code duplication across git-related services.
 * Follows DRY principle by centralizing git process spawning, error handling,
 * and output collection.
 *
 * @param workspacePath - The path to the git repository
 * @param args - Array of command arguments (e.g., ['config', 'user.name'])
 * @returns Promise resolving to stdout string or null if command fails
 */
export async function executeGitCommand(
	workspacePath: string,
	args: string[]
): Promise<string | null> {
	return new Promise((resolve, reject) => {
		const gitProcess = spawn('git', args, {
			cwd: workspacePath,
			stdio: ['pipe', 'pipe', 'pipe']
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
			// exit code 1 is common for "not found" cases (e.g., config key doesn't exist)
			// treat as non-error condition by returning null
			if (code === 1) {
				resolve(null);
				return;
			}

			// other non-zero exit codes indicate actual errors
			if (code !== 0) {
				reject(new Error(`Git Command Failed: ${stderr}`));
				return;
			}

			resolve(stdout.trim());
		});

		gitProcess.on('error', (error) => {
			// git executable not found or spawn failed
			reject(new Error(`Failed to Spawn Git Process: ${error.message}`));
		});
	});
}

/**
 * Retrieves git user configuration from local or global git config.
 *
 * This function reads user.name and user.email from git config, checking both
 * local (repository-specific) and global configuration. Used to associate
 * ballots with reviewers while maintaining privacy during the blinded phase.
 *
 * Social psychology rationale: Storing author metadata during ballot submission
 * but hiding it until reveal phase prevents normative influence and groupthink.
 * Reviewers form independent judgments without anchoring on others' identities.
 *
 * @param workspacePath - The path to the git repository
 * @returns Promise resolving to user info object or null if unavailable
 *
 * @example
 * const userInfo = await getGitUserInfo('/path/to/repo');
 * if (userInfo) {
 *   console.log(`User: ${userInfo.name} <${userInfo.email}>`);
 * }
 */
export async function getGitUserInfo(workspacePath: string): Promise<GitUserInfo | null> {
	try {
		// fetch both config values in parallel for efficiency
		const [name, email] = await Promise.all([
			executeGitCommand(workspacePath, ['config', 'user.name']),
			executeGitCommand(workspacePath, ['config', 'user.email'])
		]);

		// both name and email must be present to return valid user info
		if (!name || !email) {
			return null;
		}

		return { name, email };
	} catch (error) {
		// git not available or config not set - return null to allow graceful fallback
		return null;
	}
}

/**
 * Checks if git is available in the system.
 *
 * Useful for determining if git-based features should be enabled.
 *
 * @returns Promise resolving to true if git is available, false otherwise
 */
export async function isGitAvailable(): Promise<boolean> {
	try {
		const result = await executeGitCommand('', ['--version']);
		return result !== null;
	} catch (error) {
		return false;
	}
}
