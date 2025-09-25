(function() {
    const vscode = acquireVsCodeApi();

    // Tab management
    function initTabs() {
        const tabButtons = document.querySelectorAll('.tab-button');
        const tabPanes = document.querySelectorAll('.tab-pane');

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetTab = button.getAttribute('data-tab');
                
                // Update button states
                tabButtons.forEach(b => {
                    b.classList.remove('active');
                    b.setAttribute('aria-selected', 'false');
                });
                button.classList.add('active');
                button.setAttribute('aria-selected', 'true');

                // Update pane states
                tabPanes.forEach(pane => {
                    pane.classList.remove('active');
                });
                document.getElementById(targetTab + '-tab').classList.add('active');
            });
        });
    }

    // Context tab functionality
    function initContextTab() {
        const searchInput = document.getElementById('context-search');
        const searchButton = document.getElementById('search-button');
        const resultsDiv = document.getElementById('context-results');

        function performSearch() {
            const query = searchInput.value.trim();
            if (!query) return;

            vscode.postMessage({
                command: 'searchContext',
                query: query
            });
        }

        searchButton.addEventListener('click', performSearch);
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                performSearch();
            }
        });
    }

    // Evidence tab functionality
    function initEvidenceTab() {
        const form = document.getElementById('evidence-form');
        
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const tests = document.getElementById('tests-field').value;
            const benchmarks = document.getElementById('benchmarks-field').value;
            const spec = document.getElementById('spec-field').value;
            const risk = document.getElementById('risk-field').value;

            if (!tests.trim() || !risk.trim()) {
                alert('Tests and Risk Notes are required fields');
                return;
            }

            const evidenceBlock = generateEvidenceBlock({
                tests: tests,
                benchmarks: benchmarks || 'N/A',
                spec: spec || 'N/A',
                risk: risk
            });

            // Copy to clipboard
            navigator.clipboard.writeText(evidenceBlock).then(() => {
                alert('Evidence block copied to clipboard!');
            });
        });
    }

    // Equity tab functionality
    function initEquityTab() {
        const form = document.getElementById('ballot-form');
        const confidenceSlider = document.getElementById('confidence');
        const confidenceValue = document.getElementById('confidence-value');

        confidenceSlider.addEventListener('input', () => {
            confidenceValue.textContent = confidenceSlider.value;
        });

        form.addEventListener('submit', (e) => {
            e.preventDefault();

            const ballot = {
                prReference: document.getElementById('pr-reference').value,
                decision: document.getElementById('decision').value,
                confidence: parseInt(confidenceSlider.value),
                rationale: document.getElementById('rationale').value
            };

            if (!ballot.prReference || !ballot.decision || !ballot.rationale.trim()) {
                alert('All fields except confidence are required');
                return;
            }

            vscode.postMessage({
                command: 'submitBallot',
                ballot: ballot
            });
        });
    }

    function generateEvidenceBlock(data) {
        return `
## Chorus Evidence

**Tests**: ${data.tests}

**Benchmarks**: ${data.benchmarks}

**Spec/ADR**: ${data.spec}

**Risk Notes**: ${data.risk}
`.trim();
    }

    // Message handling from extension
    window.addEventListener('message', event => {
        const message = event.data;

        switch (message.command) {
            case 'searchResults':
                displaySearchResults(message.results);
                break;
            case 'ballotSubmitted':
                if (message.success) {
                    document.getElementById('ballot-status').innerHTML = 
                        '<div class="success">Ballot submitted successfully!</div>';
                    document.getElementById('ballot-form').reset();
                    document.getElementById('confidence-value').textContent = '3';
                }
                break;
            case 'ballotsRevealed':
                displayBallots(message.ballots);
                break;
            case 'error':
                alert('Error: ' + message.message);
                break;
        }
    });

    function displaySearchResults(results) {
        const resultsDiv = document.getElementById('context-results');
        
        if (!results || results.length === 0) {
            resultsDiv.innerHTML = '<p>No results found</p>';
            return;
        }

        resultsDiv.innerHTML = results.map(result => `
            <div class="result-item">
                <div class="result-header">
                    <span class="result-type">${result.type}</span>
                    <span class="result-title">${escapeHtml(result.title)}</span>
                </div>
                <div class="result-path">${escapeHtml(result.path)}</div>
                <div class="result-content">${escapeHtml(result.content.substring(0, 200))}</div>
            </div>
        `).join('');
    }

    function displayBallots(ballots) {
        const statusDiv = document.getElementById('ballot-status');
        
        if (!ballots || ballots.length === 0) {
            statusDiv.innerHTML = '<p>No ballots found</p>';
            return;
        }

        statusDiv.innerHTML = '<h3>Revealed Ballots:</h3>' + 
            ballots.map(ballot => `
                <div class="ballot-item">
                    <strong>${ballot.decision.toUpperCase()}</strong> 
                    (Confidence: ${ballot.confidence}/5)
                    <p>${escapeHtml(ballot.rationale)}</p>
                </div>
            `).join('');
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initTabs();
            initContextTab();
            initEvidenceTab();
            initEquityTab();
        });
    } else {
        initTabs();
        initContextTab();
        initEvidenceTab();
        initEquityTab();
    }
})();
