import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { ContextTreeProvider, ContextItem } from './ContextTreeProvider';
import { LocalDB, ContextEntry } from '../storage/LocalDB';
import { Indexer } from '../services/Indexer';

// mock vscode - using explicit external to avoid bundling issues
vi.mock('vscode', () => ({
  TreeItem: class {
    public contextValue?: string;
    public iconPath?: any;
    public label: string;
    public collapsibleState: number;
    constructor(label: string, collapsibleState: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2,
  },
  EventEmitter: class {
    event = vi.fn();
    fire = vi.fn();
  },
  ThemeIcon: class {
    constructor(public id: string) {}
  },
  Range: class {
    constructor(
      public start: any,
      public end: any
    ) {}
  },
  window: {
    onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
  },
}));

describe('ContextTreeProvider', () => {
  let db: LocalDB;
  let indexer: Indexer;
  let provider: ContextTreeProvider;

  beforeEach(() => {
    // create mock database
    db = {
      initialize: vi.fn(),
      getPRPhase: vi.fn().mockResolvedValue('blinded'),
      searchContext: vi.fn().mockResolvedValue([]),
    } as any;

    // create mock indexer
    indexer = {
      findRelevantContext: vi.fn().mockResolvedValue([]),
    } as any;

    provider = new ContextTreeProvider(db, indexer);
  });

  describe('getTreeItem', () => {
    it('should return the tree item', () => {
      const item = new ContextItem('test', vscode.TreeItemCollapsibleState.None);
      const result = provider.getTreeItem(item);
      expect(result).toBe(item);
    });
  });

  describe('getChildren', () => {
    it('should return root sections when no element provided', async () => {
      const children = await provider.getChildren();

      expect(children).toHaveLength(3);
      expect(children[0].label).toBe('Current File Context');
      expect(children[1].label).toBe('Active Reviews');
      expect(children[2].label).toBe('Recent Searches');
    });

    it('should return empty array when no file selected', async () => {
      const section = new ContextItem(
        'Current File Context',
        vscode.TreeItemCollapsibleState.Expanded,
        'section'
      );

      const children = await provider.getChildren(section);

      expect(children).toHaveLength(1);
      expect(children[0].label).toBe('No file selected');
    });

    it('should return context items when file is selected', async () => {
      // mock findRelevantContext to return some items
      const mockContext: ContextEntry[] = [
        {
          id: 1,
          type: 'commit',
          title: 'Test commit',
          path: 'abc123',
          content: 'Test content',
          metadata: { hash: 'abc123', author: 'Test Author', date: '2023-01-01' },
          indexed_at: '2023-01-01',
        },
        {
          id: 2,
          type: 'doc',
          title: 'Test doc',
          path: 'test.md',
          content: 'Test doc content',
          metadata: {},
          indexed_at: '2023-01-01',
        },
      ];

      vi.mocked(indexer.findRelevantContext).mockResolvedValue(mockContext);

      // set current file path
      (provider as any).currentFilePath = '/test/file.ts';

      const section = new ContextItem(
        'Current File Context',
        vscode.TreeItemCollapsibleState.Expanded,
        'section'
      );

      const children = await provider.getChildren(section);

      expect(children.length).toBeGreaterThan(0);
      expect(children[0].label).toContain('Related Commits');
      expect(children[1].label).toContain('Related Docs');
    });

    it('should return category items when category is expanded', async () => {
      const mockContext: ContextEntry[] = [
        {
          id: 1,
          type: 'commit',
          title: 'Test commit',
          path: 'abc123',
          content: 'Test content',
          metadata: { hash: 'abc123', author: 'Test Author', date: '2023-01-01' },
          indexed_at: '2023-01-01',
        },
      ];

      const category = new ContextItem(
        'Related Commits (1)',
        vscode.TreeItemCollapsibleState.Expanded,
        'contextCategory',
        { type: 'commit', items: mockContext }
      );

      const children = await provider.getChildren(category);

      expect(children).toHaveLength(1);
      expect(children[0].label).toContain('Test commit');
    });
  });

  describe('refresh', () => {
    it('should fire onDidChangeTreeData event', () => {
      const fireSpy = vi.spyOn((provider as any)._onDidChangeTreeData, 'fire');

      provider.refresh();

      expect(fireSpy).toHaveBeenCalledWith(undefined);
    });
  });

  describe('context item formatting', () => {
    it('should format commit items with hash and title', async () => {
      const mockContext: ContextEntry[] = [
        {
          id: 1,
          type: 'commit',
          title: 'Fix authentication bug',
          path: 'abc123def',
          content: 'Test content',
          metadata: { hash: 'abc123def', author: 'Test Author', date: '2023-01-01' },
          indexed_at: '2023-01-01',
        },
      ];

      const category = new ContextItem(
        'Related Commits (1)',
        vscode.TreeItemCollapsibleState.Expanded,
        'contextCategory',
        { type: 'commit', items: mockContext }
      );

      const children = await provider.getChildren(category);

      expect(children[0].label).toBe('[abc123d] Fix authentication bug');
    });

    it('should format doc items with filename', async () => {
      const mockContext: ContextEntry[] = [
        {
          id: 1,
          type: 'doc',
          title: 'Authentication Guide',
          path: 'docs/auth/guide.md',
          content: 'Test content',
          metadata: {},
          indexed_at: '2023-01-01',
        },
      ];

      const category = new ContextItem(
        'Related Docs (1)',
        vscode.TreeItemCollapsibleState.Expanded,
        'contextCategory',
        { type: 'doc', items: mockContext }
      );

      const children = await provider.getChildren(category);

      expect(children[0].label).toBe('guide.md');
    });
  });
});
