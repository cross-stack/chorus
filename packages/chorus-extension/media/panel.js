(function() {
    const vscode = acquireVsCodeApi();

    // tab management
    function initTabs() {
        const tabButtons = document.querySelectorAll('.tab-button');
        const tabPanes = document.querySelectorAll('.tab-pane');

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetTab = button.getAttribute('data-tab');

                // update button states
                tabButtons.forEach(b => {
                    b.classList.remove('active');
                    b.setAttribute('aria-selected', 'false');
                });
                button.classList.add('active');
                button.setAttribute('aria-selected', 'true');

                // update pane states
                tabPanes.forEach(pane => {
                    pane.classList.remove('active');
                });
                document.getElementById(targetTab + '-tab').classList.add('active');
            });
        });
    }

    // context tab functionality
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

    // evidence tab functionality
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

            // copy to clipboard
            navigator.clipboard.writeText(evidenceBlock).then(() => {
                alert('Evidence block copied to clipboard!');
            });
        });
    }

    // equity tab functionality
    function initEquityTab() {
        const form = document.getElementById('ballot-form');
        const confidenceSlider = document.getElementById('confidence');
        const confidenceValue = document.getElementById('confidence-value');
        const prReferenceInput = document.getElementById('pr-reference');
        const startReviewButton = document.getElementById('start-review-button');
        const revealButton = document.getElementById('reveal-button');

        // track current pr reference for phase management
        let currentPRReference = '';

        confidenceSlider.addEventListener('input', () => {
            confidenceValue.textContent = confidenceSlider.value;
        });

        // query phase when pr reference changes
        prReferenceInput.addEventListener('blur', () => {
            const prRef = prReferenceInput.value.trim();
            if (prRef && prRef !== currentPRReference) {
                currentPRReference = prRef;
                queryPRPhase(prRef);
            }
        });

        // start blinded review button
        startReviewButton.addEventListener('click', () => {
            const prRef = prReferenceInput.value.trim();
            if (!prRef) {
                showError('Please Enter a PR Reference First');
                return;
            }

            vscode.postMessage({
                command: 'startBlindedReview',
                prReference: prRef
            });
        });

        // ballot form submission
        form.addEventListener('submit', (e) => {
            e.preventDefault();

            const ballot = {
                prReference: prReferenceInput.value,
                decision: document.getElementById('decision').value,
                confidence: parseInt(confidenceSlider.value),
                rationale: document.getElementById('rationale').value
            };

            if (!ballot.prReference || !ballot.decision || !ballot.rationale.trim()) {
                showError('All Fields Except Confidence Are Required');
                return;
            }

            vscode.postMessage({
                command: 'submitBallot',
                ballot: ballot
            });
        });

        // reveal ballots button
        revealButton.addEventListener('click', () => {
            const prRef = prReferenceInput.value.trim();
            if (!prRef) {
                showError('Please Enter a PR Reference First');
                return;
            }

            // check if button is disabled
            if (revealButton.disabled) {
                const reason = revealButton.getAttribute('title') || 'Cannot Reveal Yet';
                showError(reason);
                return;
            }

            vscode.postMessage({
                command: 'revealBallots',
                prReference: prRef
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

    // reusable ui helpers - dry principle
    // pluralistic ignorance: members suppress dissent, mistaking silence for agreement
    // blinded phase breaks this by collecting anonymous votes first

    /**
     * creates and renders a phase badge element
     * @param {string} phase - 'blinded' or 'revealed'
     * @returns {string} html string for phase badge
     */
    function createPhaseBadge(phase) {
        const isBlinded = phase === 'blinded';
        const icon = isBlinded ? '🔒' : '👁️';
        const label = isBlinded ? 'Blinded Phase' : 'Revealed Phase';
        const className = `phase-badge ${phase}`;
        const ariaLabel = isBlinded
            ? 'Currently in blinded review phase - ballots are anonymous'
            : 'Currently in revealed phase - ballots are visible';

        return `<div class="${className}" role="status" aria-label="${ariaLabel}">
            <span class="phase-icon">${icon}</span>
            <span class="phase-label">${label}</span>
        </div>`;
    }

    /**
     * updates ballot threshold display
     * @param {number} count - current ballot count
     * @param {number} threshold - minimum required (future enhancement)
     * @returns {string} html string for threshold display
     */
    function updateBallotThreshold(count, threshold) {
        // for now, threshold is optional - show count if available
        if (count === 0) {
            return '<p class="ballot-count">No Ballots Submitted Yet</p>';
        }

        const plural = count === 1 ? 'Ballot' : 'Ballots';
        return `<p class="ballot-count">${count} ${plural} Submitted</p>`;
    }

    /**
     * sets button state with accessibility support
     * @param {HTMLElement} button - button element to update
     * @param {boolean} enabled - whether button should be enabled
     * @param {string} reason - explanation for disabled state (title case)
     */
    function setButtonState(button, enabled, reason = '') {
        if (enabled) {
            button.disabled = false;
            button.removeAttribute('title');
            button.removeAttribute('aria-disabled');
        } else {
            button.disabled = true;
            button.setAttribute('title', reason);
            button.setAttribute('aria-disabled', 'true');
        }
    }

    /**
     * renders the complete phase section ui
     * @param {Object} phaseData - phase information from backend
     */
    function renderPhaseSection(phaseData) {
        const phaseSection = document.getElementById('phase-section');
        if (!phaseSection) return;

        const { phase, ballotCount, canReveal, canSubmit } = phaseData;

        // render phase badge
        const phaseBadgeHtml = createPhaseBadge(phase);
        const ballotThresholdHtml = updateBallotThreshold(ballotCount, 0);

        phaseSection.innerHTML = `
            ${phaseBadgeHtml}
            ${ballotThresholdHtml}
            <p class="equity-help-text">Anonymous Voting Reduces Conformity Pressure</p>
        `;

        // update button states
        const startButton = document.getElementById('start-review-button');
        const revealButton = document.getElementById('reveal-button');

        // start button only shown if pr doesn't exist yet
        if (startButton) {
            if (phase === 'blinded' && ballotCount === 0) {
                startButton.style.display = 'inline-block';
            } else {
                startButton.style.display = 'none';
            }
        }

        // reveal button state based on phase
        if (revealButton) {
            if (phase === 'revealed') {
                setButtonState(revealButton, false, 'Already Revealed');
            } else if (!canReveal) {
                setButtonState(revealButton, false, 'Cannot Reveal: No Ballots Submitted Yet');
            } else {
                setButtonState(revealButton, true);
            }
        }
    }

    /**
     * queries backend for current pr phase and ballot count
     * @param {string} prReference - pr identifier
     */
    function queryPRPhase(prReference) {
        vscode.postMessage({
            command: 'getPRPhase',
            prReference: prReference
        });
    }

    /**
     * shows error message to user (title case)
     * @param {string} message - error message in title case
     */
    function showError(message) {
        const statusDiv = document.getElementById('ballot-status');
        if (statusDiv) {
            statusDiv.innerHTML = `<div class="error-message">${escapeHtml(message)}</div>`;
            // clear error after 5 seconds
            setTimeout(() => {
                statusDiv.innerHTML = '';
            }, 5000);
        }
    }

    /**
     * shows success message to user (title case)
     * @param {string} message - success message in title case
     */
    function showSuccess(message) {
        const statusDiv = document.getElementById('ballot-status');
        if (statusDiv) {
            statusDiv.innerHTML = `<div class="success">${escapeHtml(message)}</div>`;
        }
    }

    // message handling from extension
    window.addEventListener('message', event => {
        const message = event.data;

        switch (message.command) {
            case 'searchResults':
                displaySearchResults(message.results);
                break;
            case 'prPhaseUpdate':
                // update phase section with new data
                renderPhaseSection(message.phaseData);
                break;
            case 'blindedReviewStarted':
                if (message.success) {
                    showSuccess('Blinded Review Started Successfully');
                    // refresh phase display
                    queryPRPhase(message.prReference);
                }
                break;
            case 'ballotSubmitted':
                if (message.success) {
                    showSuccess('Ballot Submitted Successfully!');
                    document.getElementById('ballot-form').reset();
                    document.getElementById('confidence-value').textContent = '3';
                    // refresh phase display to update ballot count
                    const prRef = document.getElementById('pr-reference').value.trim();
                    if (prRef) {
                        queryPRPhase(prRef);
                    }
                }
                break;
            case 'ballotsRevealed':
                displayBallots(message.ballots);
                // refresh phase display to show revealed state
                const prRef = document.getElementById('pr-reference').value.trim();
                if (prRef) {
                    queryPRPhase(prRef);
                }
                break;
            case 'error':
                showError(message.message);
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
            statusDiv.innerHTML = '<p>No Ballots Found</p>';
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

    // initialize when DOM is ready
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
