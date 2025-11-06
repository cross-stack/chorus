# Chorus - Evidence-First Code Review Extension

[![CI](https://github.com/user/chorus/actions/workflows/ci.yml/badge.svg)](https://github.com/user/chorus/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/badge/coverage-%E2%89%A580%25-brightgreen)]()
[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-blue)]()

> **Transform code reviews into learning-centered, equitable, and evidence-first decision spaces**

Chorus helps developer teams surface hidden context, reduce conformity pressure, and make evidence-based decisions during code reviews. Built as a VS Code/Positron extension with local-first privacy principles.

## 🎯 Vision

Code reviews should be spaces for learning and evidence-based decision making, not battles of opinion or conformity pressure. Chorus transforms your review process by:

- **Surfacing Context**: Automatically discover relevant PRs, commits, docs, and discussions
- **Requiring Evidence**: Structured templates for tests, benchmarks, specs, and risk assessment
- **Promoting Equity**: Blinded first-pass reviews and quiet ballots to reduce bias

## ✨ Features

### 🔍 **Context Discovery**
- **Smart CodeLens**: "Related context (n)" annotations on changed files
- **Git History Indexing**: Automatic scanning of commits and documentation
- **Relevance Ranking**: BM25-style scoring to surface the most relevant context
- **Documentation Integration**: Indexes README files, ADRs, and specs

### 📊 **Evidence-First Reviews**
- **Structured PR Templates**: Required sections for Tests, Benchmarks, Specs, Risk Assessment
- **Test Evidence Parsing**: Smart detection and formatting of Jest/Vitest/generic test output
- **Evidence Validation**: Local validation rules with quick-fixes
- **Copy-Paste Integration**: `Ctrl+Shift+V` to parse clipboard test results

### ⚖️ **Equitable Decision Making**
- **Quiet Ballots**: Anonymous voting with confidence levels (1-5)
- **Blinded Reviews**: Author metadata hidden until first-pass completion
- **Bias Detection**: Language analysis for objective feedback
- **Reveal Controls**: Voluntary author identity disclosure

### 🔒 **Privacy & Security**
- **Local-First**: All data stored locally in SQLite
- **No Network Calls**: Privacy-preserving by design
- **PII Redaction**: Automatic redaction in exports
- **Secure Storage**: Anonymous ballot IDs with optional reveal

## 🚀 Quick Start

### Installation

1. **From VS Code Marketplace** (coming soon):
   ```bash
   code --install-extension chorus.chorus-extension
   ```

2. **From VSIX** (development):
   ```bash
   code --install-extension chorus-extension-0.1.0.vsix
   ```

3. **From Source**:
   ```bash
   git clone https://github.com/user/chorus.git
   cd chorus
   npm ci
   cd packages/chorus-extension
   npm ci
   npm run build
   code --install-extension .
   ```

### First Steps

1. **Open the Chorus Panel**: `Ctrl+Shift+P` → "Show Chorus Panel"
2. **Enable CodeLens**: Settings → Extensions → Chorus → Enable Related Context
3. **Start a Review**: Create a PR and use the Chorus Evidence template
4. **Add Evidence**: `Ctrl+Shift+P` → "Add Chorus Evidence Block"

## 📖 Usage Guide

### Context Tab
- View related commits, PRs, and documentation for your changes
- Click items to open in editor or browser
- Use search to filter by keywords or file paths
- Export context reports for stakeholders

### Evidence Tab
- Generate evidence blocks for PR descriptions
- Paste test results from clipboard (supports JSON parsing)
- Validate required fields before submission
- Link to specifications and ADR documents

### Equity Tab - Blinded First-Pass Reviews

**Psychological Foundation**: Blinded reviews reduce normative influence (conformity pressure) and combat pluralistic ignorance (hidden disagreement).

**Workflow**:
1. **Start Review**: Enter PR reference and click "Start Blinded Review"
   - Sets PR to blinded phase (author identities hidden)
   - Team members can now submit anonymous ballots

2. **Submit Ballots**: Each reviewer provides:
   - Decision: Approve / Neutral / Reject
   - Confidence: 1-5 slider (calibrated judgment)
   - Rationale: Evidence-based reasoning

3. **Reveal Phase**: After minimum threshold (e.g., 3+ ballots):
   - "Reveal Results" button becomes enabled
   - Click to transition from blinded → revealed
   - View all ballots with author names and aggregated results

**Privacy Controls**:
- Ballots are anonymous during blinded phase
- Author metadata (from git config) stored but not displayed
- Voluntary reveal when team is ready

## 🎮 Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| `chorus.showPanel` | `Ctrl+Shift+C` | Open the main Chorus panel |
| `chorus.addEvidence` | `Ctrl+Shift+V` | Add evidence block from clipboard |
| `chorus.submitFirstPass` | - | Submit anonymous first-pass ballot |

## 🏗️ Architecture

```
packages/chorus-extension/
├── src/
│   ├── extension.ts              # Main entry point & command registration
│   ├── codelens/
│   │   └── RelatedContextProvider.ts  # "Related context (n)" annotations
│   ├── panel/
│   │   └── ChorusPanel.ts        # Webview UI with Context/Evidence/Equity tabs
│   ├── services/
│   │   ├── GitService.ts         # Git log parsing and file operations
│   │   └── Indexer.ts            # Workspace indexing with BM25 scoring
│   └── storage/
│       └── LocalDB.ts            # SQLite database for local-first storage
├── media/                        # Webview assets (CSS, JS)
└── test/                         # Comprehensive test suite (>80% coverage)
```

### Core Principles

- **Local-First**: All data stays on your machine
- **Privacy-Preserving**: No telemetry without explicit opt-in
- **Evidence-Based**: Structured templates require supporting data
- **Bias-Reducing**: Blinded reviews and anonymous ballots
- **Context-Rich**: Automatic discovery of relevant information

## 🧪 Development

### Setup

```bash
git clone https://github.com/user/chorus.git
cd chorus
npm ci                                    # Install workspace dependencies
cd packages/chorus-extension
npm ci                                    # Install extension dependencies
```

### Local Development

```bash
npm run build          # Compile TypeScript
npm run test           # Run unit tests
npm test:coverage      # Run tests with coverage
npm run lint           # ESLint code quality
npm run format         # Prettier code formatting
```

### Testing in VS Code

1. Open the project in VS Code
2. Press `F5` to launch Extension Development Host
3. Test commands and features in the new VS Code window

### Extension Integration Tests

```bash
# Install test dependencies
npm install @vscode/test-electron

# Run integration tests (requires Xvfb on Linux)
npm run test:integration
```

## 📊 Quality Metrics

- **Test Coverage**: ≥80% lines, functions, branches, statements
- **TypeScript**: Strict mode with comprehensive typing
- **Code Quality**: ESLint + Prettier with consistent formatting
- **CI/CD**: GitHub Actions with coverage gates and artifact publishing

## 🤝 Contributing

1. **Fork & Clone**: Create your own fork and clone locally
2. **Branch**: Create a feature branch (`git checkout -b feat/amazing-feature`)
3. **Develop**: Write code following existing patterns and style
4. **Test**: Ensure tests pass and coverage remains ≥80%
5. **Evidence**: Use the Chorus PR template with evidence blocks
6. **Submit**: Create a PR with comprehensive evidence

### Code Style

- **TypeScript Strict**: Full type safety required
- **Small Functions**: Keep functions focused and testable
- **KISS Principle**: Simple, clear implementations
- **DRY Code**: Avoid repetition, create reusable utilities
- **Consistent Naming**: Follow established conventions

## 📋 Roadmap

### Phase 1 (Current) ✅
- [x] VS Code extension with Context/Evidence/Equity tabs
- [x] Git history and documentation indexing
- [x] Evidence block generation with JSON parsing
- [x] Quiet ballot system with privacy controls
- [x] Comprehensive test suite with >80% coverage

### Phase 2 (Planned)
- [ ] GitHub integration for PR context
- [ ] Advanced bias detection algorithms
- [ ] Team analytics and insights dashboard
- [ ] Slack/Teams integration for notifications
- [ ] Custom evidence templates per project

### Phase 3 (Future)
- [ ] Multi-repository context discovery
- [ ] ML-powered relevance suggestions
- [ ] Integration with issue trackers (Jira, Linear)
- [ ] Advanced accessibility features
- [ ] Enterprise SSO and compliance features

## 🐛 Known Issues

- Integration tests require display server (Xvfb) on headless Linux
- Some Git operations may timeout on very large repositories
- Webview UI performance degrades with >1000 context items
- Windows path handling edge cases in file indexing

## 🙋 Support

- **Documentation**: See `/docs` for detailed guides
- **Issues**: [GitHub Issues](https://github.com/user/chorus/issues)
- **Discussions**: [GitHub Discussions](https://github.com/user/chorus/discussions)
- **Email**: [support@chorus.dev](mailto:support@chorus.dev)

## 📜 License

MIT License - see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- VS Code Extension API team for comprehensive documentation
- SQLite team for robust local storage capabilities
- Open source testing frameworks (Vitest, Jest) for inspiration
- The developer community for feedback and contributions

---

**Built with ❤️ by the Chorus team**

*Making code reviews more equitable, evidence-based, and context-rich, one extension at a time.*