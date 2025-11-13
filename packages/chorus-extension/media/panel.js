(function () {
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
        const rationaleTextarea = document.getElementById('rationale');
        const rationaleCount = document.getElementById('rationale-count');
        const confidenceHint = document.getElementById('confidence-hint');

        // track current pr reference for phase management
        let currentPRReference = '';
        let detectedPRData = null;

        // confidence slider with labels
        const confidenceLabels = {
            1: '1 - Very Low',
            2: '2 - Low',
            3: '3 - Medium',
            4: '4 - High',
            5: '5 - Very High'
        };

        confidenceSlider.addEventListener('input', () => {
            const value = confidenceSlider.value;
            confidenceValue.textContent = confidenceLabels[value] || value;

            // show smart hints based on confidence level
            showConfidenceHint(parseInt(value));
        });

        // character counter for rationale
        if (rationaleTextarea && rationaleCount) {
            rationaleTextarea.addEventListener('input', () => {
                const length = rationaleTextarea.value.length;
                rationaleCount.textContent = `${length} characters`;

                // color coding based on length
                if (length < 20) {
                    rationaleCount.className = 'character-count warning';
                } else if (length > 500) {
                    rationaleCount.className = 'character-count warning';
                } else {
                    rationaleCount.className = 'character-count';
                }
            });
        }

        function showConfidenceHint(confidence) {
            if (!confidenceHint) return;

            let hint = '';
            let className = 'hint-message';

            if (confidence <= 2) {
                hint = 'Low confidence detected. Make sure to fill in the main risk field below.';
                className = 'hint-message warning';
            } else if (confidence >= 4) {
                hint = 'High confidence. Ensure your rationale includes strong evidence.';
                className = 'hint-message info';
            } else {
                hint = '';
            }

            if (hint) {
                confidenceHint.textContent = hint;
                confidenceHint.className = className;
                confidenceHint.style.display = 'block';
            } else {
                confidenceHint.style.display = 'none';
            }
        }

        // auto-detect PR handling
        const autoDetectBanner = document.getElementById('pr-auto-detect-banner');
        const autoDetectText = document.getElementById('pr-auto-detect-text');
        const useDetectedPRButton = document.getElementById('use-detected-pr');

        if (useDetectedPRButton) {
            useDetectedPRButton.addEventListener('click', () => {
                if (detectedPRData && detectedPRData.prReference) {
                    prReferenceInput.value = detectedPRData.prReference;
                    prReferenceInput.dispatchEvent(new Event('blur'));
                    if (autoDetectBanner) {
                        autoDetectBanner.style.display = 'none';
                    }
                }
            });
        }

        // recent PRs dropdown
        const recentPRsDropdown = document.getElementById('recent-prs-dropdown');
        if (recentPRsDropdown) {
            recentPRsDropdown.addEventListener('change', (e) => {
                const selectedPR = e.target.value;
                if (selectedPR) {
                    prReferenceInput.value = selectedPR;
                    prReferenceInput.dispatchEvent(new Event('blur'));
                }
            });
        }

        // request auto-detection when tab loads
        vscode.postMessage({ command: 'autoDetectPR' });
        vscode.postMessage({ command: 'getRecentPRs' });

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

            const confidence = parseInt(confidenceSlider.value);
            const mainRisk = document.getElementById('nudge-main-risk').value.trim();

            // validate main risk is provided if confidence < 3
            if (confidence < 3 && !mainRisk) {
                showError('Main Risk is Required When Confidence is Below 3');
                return;
            }

            const ballot = {
                prReference: prReferenceInput.value,
                decision: document.getElementById('decision').value,
                confidence: confidence,
                rationale: document.getElementById('rationale').value
            };

            if (!ballot.prReference || !ballot.decision || !ballot.rationale.trim()) {
                showError('All Fields Except Confidence Are Required');
                return;
            }

            // collect nudge responses (only if nudge section is visible)
            const nudgeSection = document.getElementById('nudge-section');
            if (nudgeSection && nudgeSection.style.display !== 'none') {
                ballot.nudge_responses = {
                    consideredAlternatives: document.getElementById('nudge-alternatives').checked,
                    mainRisk: mainRisk,
                    dissentingViews: document.getElementById('nudge-dissent').value.trim() || undefined
                };
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

        // show/hide nudge section based on phase
        const nudgeSection = document.getElementById('nudge-section');
        if (nudgeSection) {
            if (phase === 'blinded') {
                nudgeSection.style.display = 'block';
            } else {
                nudgeSection.style.display = 'none';
            }
        }

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

    /**
     * handles auto-detected PR data from extension
     * @param {Object} data - auto-detected PR information
     */
    function handlePRAutoDetected(data) {
        const autoDetectBanner = document.getElementById('pr-auto-detect-banner');
        const autoDetectText = document.getElementById('pr-auto-detect-text');

        if (!autoDetectBanner || !autoDetectText) return;

        if (data.prReference) {
            let message = `Detected PR ${data.prReference} from branch "${data.branch}"`;
            if (data.prTitle) {
                message += `: ${data.prTitle}`;
            }
            if (data.existsInDB) {
                message += ` (${data.ballotCount} ballot${data.ballotCount === 1 ? '' : 's'} submitted)`;
            }

            autoDetectText.textContent = message;
            autoDetectBanner.style.display = 'flex';

            // store for use button
            window.detectedPRData = data;
        } else if (data.branch) {
            autoDetectText.textContent = `On branch "${data.branch}" - No PR detected`;
            autoDetectBanner.style.display = 'flex';
            // hide use button
            const useButton = document.getElementById('use-detected-pr');
            if (useButton) {
                useButton.style.display = 'none';
            }
        }
    }

    /**
     * populates recent PRs dropdown
     * @param {Array} recentPRs - array of recent PR objects
     */
    function populateRecentPRsDropdown(recentPRs) {
        const dropdown = document.getElementById('recent-prs-dropdown');
        if (!dropdown) return;

        // clear existing options except first one
        dropdown.innerHTML = '<option value="">Select a recent PR...</option>';

        if (!recentPRs || recentPRs.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No recent PRs';
            option.disabled = true;
            dropdown.appendChild(option);
            return;
        }

        recentPRs.forEach(pr => {
            const option = document.createElement('option');
            option.value = pr.prReference;

            let label = pr.prReference;
            if (pr.phase) {
                label += ` (${pr.phase})`;
            }
            label += ` - ${pr.ballotCount} ballot${pr.ballotCount === 1 ? '' : 's'}`;

            // format relative time
            const lastActivity = new Date(pr.lastActivity);
            const now = new Date();
            const diffMs = now - lastActivity;
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);

            let timeAgo = '';
            if (diffMins < 60) {
                timeAgo = `${diffMins}m ago`;
            } else if (diffHours < 24) {
                timeAgo = `${diffHours}h ago`;
            } else {
                timeAgo = `${diffDays}d ago`;
            }

            label += ` - ${timeAgo}`;
            option.textContent = label;
            dropdown.appendChild(option);
        });
    }

    // message handling from extension
    window.addEventListener('message', event => {
        const message = event.data;

        switch (message.command) {
            case 'prAutoDetected':
                handlePRAutoDetected(message.data);
                break;
            case 'recentPRs':
                populateRecentPRsDropdown(message.data);
                break;
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
                    // reset nudge fields
                    document.getElementById('nudge-alternatives').checked = false;
                    document.getElementById('nudge-main-risk').value = '';
                    document.getElementById('nudge-dissent').value = '';
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
            case 'calibrationData':
                renderCalibrationData(message.data);
                break;
            case 'reflectionTimeline':
                renderReflectionTimeline(message.timeline);
                break;
            case 'patternInsights':
                renderPatternInsights(message.insights);
                break;
            case 'decisionSchemeSaved':
                showSuccess('Decision Scheme Saved Successfully');
                const schemeModal = document.getElementById('decision-scheme-modal');
                if (schemeModal) {
                    schemeModal.style.display = 'none';
                }
                break;
            case 'retrospectiveSaved':
                showSuccess('Retrospective Saved Successfully');
                const retroModal = document.getElementById('retrospective-modal');
                if (retroModal) {
                    retroModal.style.display = 'none';
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

    // calibration tab functionality
    function initCalibrationTab() {
        const refreshButton = document.getElementById('refresh-calibration');

        if (refreshButton) {
            refreshButton.addEventListener('click', () => {
                loadCalibrationData();
            });
        }

        // load data on tab activation
        const calibrationTabButton = document.querySelector('[data-tab="calibration"]');
        if (calibrationTabButton) {
            calibrationTabButton.addEventListener('click', () => {
                // slight delay to allow tab transition
                setTimeout(() => {
                    loadCalibrationData();
                }, 100);
            });
        }
    }

    /**
     * requests calibration data from extension
     */
    function loadCalibrationData() {
        vscode.postMessage({
            command: 'getCalibrationData'
        });
    }

    /**
     * renders calibration data in the dashboard
     * @param {Object} data - calibration metrics object
     */
    function renderCalibrationData(data) {
        // update statistics
        document.getElementById('brier-score').textContent =
            data.brierScore !== undefined ? data.brierScore.toFixed(3) : '--';

        document.getElementById('total-predictions').textContent =
            data.totalPredictions || '0';

        document.getElementById('overall-accuracy').textContent =
            data.overallAccuracy !== undefined ?
                (Math.round(data.overallAccuracy * 100) + '%') : '--';

        // render calibration chart
        renderCalibrationChart(data.calibrationCurve || []);

        // render insights
        renderInsights(data.insights || []);

        // render outcome history
        renderOutcomeHistory(data.history || []);
    }

    /**
     * renders calibration curve as simple bar chart
     * @param {Array} curve - array of {confidence, actualAccuracy, count} objects
     */
    function renderCalibrationChart(curve) {
        const chartDiv = document.getElementById('calibration-chart');
        if (!chartDiv) return;

        if (curve.length === 0) {
            chartDiv.innerHTML = '<p class="equity-help-text">No data available. Submit ballots and tag outcomes to build your calibration profile.</p>';
            return;
        }

        let html = '<div class="chart-bars">';

        for (const point of curve) {
            const expectedAccuracy = point.confidence / 5;
            const actualPct = Math.round(point.actualAccuracy * 100);
            const expectedPct = Math.round(expectedAccuracy * 100);
            const barWidth = actualPct;

            // determine color based on calibration
            let color = '#4a9eff'; // blue default
            const diff = point.actualAccuracy - expectedAccuracy;
            if (Math.abs(diff) < 0.1) {
                color = '#4caf50'; // green - well calibrated
            } else if (diff < -0.2) {
                color = '#ff9800'; // orange - overconfident
            } else if (diff > 0.2) {
                color = '#9c27b0'; // purple - underconfident
            }

            html += `
                <div class="chart-row">
                    <div class="chart-label">Confidence ${point.confidence}</div>
                    <div class="chart-bar-container">
                        <div class="chart-bar" style="width: ${barWidth}%; background-color: ${color}">
                            ${actualPct}%
                        </div>
                        <div class="chart-expected" style="left: ${expectedPct}%"></div>
                    </div>
                    <div class="chart-info">(n=${point.count}, expected: ${expectedPct}%)</div>
                </div>
            `;
        }

        html += '</div>';
        html += '<div class="chart-legend">';
        html += '<div><span class="legend-green"></span> Well calibrated</div>';
        html += '<div><span class="legend-orange"></span> Overconfident</div>';
        html += '<div><span class="legend-purple"></span> Underconfident</div>';
        html += '<div class="legend-expected-line"></div> Expected accuracy';
        html += '</div>';

        chartDiv.innerHTML = html;
    }

    /**
     * renders calibration insights list
     * @param {Array} insights - array of insight strings
     */
    function renderInsights(insights) {
        const insightsDiv = document.getElementById('calibration-insights');
        if (!insightsDiv) return;

        if (insights.length === 0) {
            insightsDiv.innerHTML = '<p class="equity-help-text">No insights available yet.</p>';
            return;
        }

        let html = '<ul class="insights-list-items">';
        for (const insight of insights) {
            html += `<li class="insight-item">${escapeHtml(insight)}</li>`;
        }
        html += '</ul>';

        insightsDiv.innerHTML = html;
    }

    /**
     * renders outcome history table
     * @param {Array} history - array of outcome entries
     */
    function renderOutcomeHistory(history) {
        const historyDiv = document.getElementById('outcome-history');
        if (!historyDiv) return;

        if (history.length === 0) {
            historyDiv.innerHTML = '<p class="equity-help-text">No outcome history yet. Tag PR outcomes in the Equity tab after ballots are revealed.</p>';
            return;
        }

        let html = '<table class="outcome-table">';
        html += '<thead><tr>';
        html += '<th>PR</th>';
        html += '<th>Your Confidence</th>';
        html += '<th>Outcome</th>';
        html += '<th>Accurate?</th>';
        html += '</tr></thead>';
        html += '<tbody>';

        for (const entry of history) {
            const accurateIcon = entry.accurate ? '✓' : '✗';
            const accurateClass = entry.accurate ? 'accurate' : 'inaccurate';
            const outcomeLabel = formatOutcomeType(entry.outcomeType);

            html += '<tr>';
            html += `<td>${escapeHtml(entry.prReference)}</td>`;
            html += `<td>${entry.confidence}/5</td>`;
            html += `<td>${outcomeLabel}</td>`;
            html += `<td class="${accurateClass}">${accurateIcon}</td>`;
            html += '</tr>';
        }

        html += '</tbody></table>';
        historyDiv.innerHTML = html;
    }

    /**
     * formats outcome type for display
     * @param {string} type - outcome type
     * @returns {string} formatted label
     */
    function formatOutcomeType(type) {
        const labels = {
            'merged_clean': 'Merged Clean',
            'bug_found': 'Bug Found',
            'reverted': 'Reverted',
            'followup_required': 'Follow-up Required'
        };
        return labels[type] || type;
    }

    // reflection tab functionality
    function initReflectionTab() {
        const filterButton = document.getElementById('filter-timeline');
        const clearButton = document.getElementById('clear-filters');
        const analyzePatternsButton = document.getElementById('analyze-patterns');
        const exportReportButton = document.getElementById('export-report');

        if (filterButton) {
            filterButton.addEventListener('click', () => {
                const startDate = document.getElementById('reflection-date-start').value;
                const endDate = document.getElementById('reflection-date-end').value;
                vscode.postMessage({
                    command: 'getReflectionTimeline',
                    filters: { start_date: startDate, end_date: endDate }
                });
            });
        }

        if (clearButton) {
            clearButton.addEventListener('click', () => {
                document.getElementById('reflection-date-start').value = '';
                document.getElementById('reflection-date-end').value = '';
                vscode.postMessage({
                    command: 'getReflectionTimeline',
                    filters: {}
                });
            });
        }

        if (analyzePatternsButton) {
            analyzePatternsButton.addEventListener('click', () => {
                vscode.postMessage({ command: 'analyzePatterns' });
            });
        }

        if (exportReportButton) {
            exportReportButton.addEventListener('click', () => {
                vscode.postMessage({ command: 'exportReport' });
            });
        }

        // decision scheme modal handlers
        const schemeSelect = document.getElementById('scheme-type');
        const customGroup = document.getElementById('custom-scheme-group');

        if (schemeSelect && customGroup) {
            schemeSelect.addEventListener('change', () => {
                customGroup.style.display = schemeSelect.value === 'custom' ? 'block' : 'none';
            });
        }

        const schemeForm = document.getElementById('decision-scheme-form');
        if (schemeForm) {
            schemeForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const formData = {
                    scheme_type: document.getElementById('scheme-type').value,
                    rationale: document.getElementById('scheme-rationale').value,
                    custom_scheme_name: document.getElementById('custom-scheme-name').value
                };
                vscode.postMessage({ command: 'saveDecisionScheme', data: formData });
            });
        }

        const schemeCancelButton = document.getElementById('scheme-cancel');
        if (schemeCancelButton) {
            schemeCancelButton.addEventListener('click', () => {
                const modal = document.getElementById('decision-scheme-modal');
                if (modal) {
                    modal.style.display = 'none';
                }
            });
        }

        // retrospective modal handlers
        const retroForm = document.getElementById('retrospective-form');
        if (retroForm) {
            retroForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const biases = Array.from(document.querySelectorAll('input[name="bias"]:checked'))
                    .map(cb => cb.value);

                const formData = {
                    what_went_wrong: document.getElementById('retro-what-wrong').value,
                    what_to_improve: document.getElementById('retro-what-improve').value,
                    bias_patterns: biases
                };
                vscode.postMessage({ command: 'saveRetrospective', data: formData });
            });
        }

        const retroDismissButton = document.getElementById('retro-dismiss');
        if (retroDismissButton) {
            retroDismissButton.addEventListener('click', () => {
                const modal = document.getElementById('retrospective-modal');
                if (modal) {
                    modal.style.display = 'none';
                }
            });
        }

        // other bias checkbox handler
        const otherBiasCheckbox = document.querySelector('input[name="bias"][value="other"]');
        const otherBiasGroup = document.getElementById('other-bias-group');
        if (otherBiasCheckbox && otherBiasGroup) {
            otherBiasCheckbox.addEventListener('change', () => {
                otherBiasGroup.style.display = otherBiasCheckbox.checked ? 'block' : 'none';
            });
        }

        // load initial data
        vscode.postMessage({ command: 'getReflectionTimeline', filters: {} });
    }

    /**
     * renders reflection timeline data
     * @param {Array} timeline - timeline entries
     */
    function renderReflectionTimeline(timeline) {
        const container = document.getElementById('decision-timeline');
        if (!container) return;

        if (!timeline || timeline.length === 0) {
            container.innerHTML = '<p class="placeholder-text">No decisions recorded yet</p>';
            return;
        }

        let html = '<table><thead><tr><th>PR</th><th>Date</th><th>Scheme</th><th>Outcome</th></tr></thead><tbody>';
        timeline.forEach(item => {
            const date = new Date(item.timestamp).toLocaleDateString();
            const schemeType = item.scheme?.scheme_type || 'N/A';
            html += `<tr>
                <td>${escapeHtml(item.pr_id)}</td>
                <td>${date}</td>
                <td>${escapeHtml(schemeType)}</td>
                <td>${escapeHtml(item.trigger_type)}</td>
            </tr>`;
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    }

    /**
     * renders pattern insights
     * @param {Array} insights - pattern analysis results
     */
    function renderPatternInsights(insights) {
        const container = document.getElementById('pattern-insights');
        if (!container) return;

        if (!insights || insights.length === 0) {
            container.innerHTML = '<p class="placeholder-text">No patterns detected</p>';
            return;
        }

        let html = '<ul>';
        insights.forEach(insight => {
            html += `<li><strong>${escapeHtml(insight.pattern)}</strong>: ${escapeHtml(insight.description)} (Evidence: ${escapeHtml(insight.evidence)})</li>`;
        });
        html += '</ul>';
        container.innerHTML = html;
    }

    // calibration tab functionality
    function initCalibrationTab() {
        const refreshButton = document.getElementById('refresh-calibration');

        if (refreshButton) {
            refreshButton.addEventListener('click', () => {
                loadCalibrationData();
            });
        }

        // load data on tab activation
        const calibrationTabButton = document.querySelector('[data-tab="calibration"]');
        if (calibrationTabButton) {
            calibrationTabButton.addEventListener('click', () => {
                // slight delay to allow tab transition
                setTimeout(() => {
                    loadCalibrationData();
                }, 100);
            });
        }
    }

    /**
     * requests calibration data from extension
     */
    function loadCalibrationData() {
        vscode.postMessage({
            command: 'getCalibrationData'
        });
    }

    /**
     * renders calibration data in the dashboard
     * @param {Object} data - calibration metrics object
     */
    function renderCalibrationData(data) {
        // update statistics
        document.getElementById('brier-score').textContent =
            data.brierScore !== undefined ? data.brierScore.toFixed(3) : '--';

        document.getElementById('total-predictions').textContent =
            data.totalPredictions || '0';

        document.getElementById('overall-accuracy').textContent =
            data.overallAccuracy !== undefined ?
            (Math.round(data.overallAccuracy * 100) + '%') : '--';

        // render calibration chart
        renderCalibrationChart(data.calibrationCurve || []);

        // render insights
        renderInsights(data.insights || []);

        // render outcome history
        renderOutcomeHistory(data.history || []);
    }

    /**
     * renders calibration curve as simple bar chart
     * @param {Array} curve - array of {confidence, actualAccuracy, count} objects
     */
    function renderCalibrationChart(curve) {
        const chartDiv = document.getElementById('calibration-chart');
        if (!chartDiv) return;

        if (curve.length === 0) {
            chartDiv.innerHTML = '<p class="equity-help-text">No data available. Submit ballots and tag outcomes to build your calibration profile.</p>';
            return;
        }

        let html = '<div class="chart-bars">';

        for (const point of curve) {
            const expectedAccuracy = point.confidence / 5;
            const actualPct = Math.round(point.actualAccuracy * 100);
            const expectedPct = Math.round(expectedAccuracy * 100);
            const barWidth = actualPct;

            // determine color based on calibration
            let color = '#4a9eff'; // blue default
            const diff = point.actualAccuracy - expectedAccuracy;
            if (Math.abs(diff) < 0.1) {
                color = '#4caf50'; // green - well calibrated
            } else if (diff < -0.2) {
                color = '#ff9800'; // orange - overconfident
            } else if (diff > 0.2) {
                color = '#9c27b0'; // purple - underconfident
            }

            html += `
                <div class="chart-row">
                    <div class="chart-label">Confidence ${point.confidence}</div>
                    <div class="chart-bar-container">
                        <div class="chart-bar" style="width: ${barWidth}%; background-color: ${color}">
                            ${actualPct}%
                        </div>
                        <div class="chart-expected" style="left: ${expectedPct}%"></div>
                    </div>
                    <div class="chart-info">(n=${point.count}, expected: ${expectedPct}%)</div>
                </div>
            `;
        }

        html += '</div>';
        html += '<div class="chart-legend">';
        html += '<div><span class="legend-green"></span> Well calibrated</div>';
        html += '<div><span class="legend-orange"></span> Overconfident</div>';
        html += '<div><span class="legend-purple"></span> Underconfident</div>';
        html += '<div class="legend-expected-line"></div> Expected accuracy';
        html += '</div>';

        chartDiv.innerHTML = html;
    }

    /**
     * renders calibration insights list
     * @param {Array} insights - array of insight strings
     */
    function renderInsights(insights) {
        const insightsDiv = document.getElementById('calibration-insights');
        if (!insightsDiv) return;

        if (insights.length === 0) {
            insightsDiv.innerHTML = '<p class="equity-help-text">No insights available yet.</p>';
            return;
        }

        let html = '<ul class="insights-list-items">';
        for (const insight of insights) {
            html += `<li class="insight-item">${escapeHtml(insight)}</li>`;
        }
        html += '</ul>';

        insightsDiv.innerHTML = html;
    }

    /**
     * renders outcome history table
     * @param {Array} history - array of outcome entries
     */
    function renderOutcomeHistory(history) {
        const historyDiv = document.getElementById('outcome-history');
        if (!historyDiv) return;

        if (history.length === 0) {
            historyDiv.innerHTML = '<p class="equity-help-text">No outcome history yet. Tag PR outcomes in the Equity tab after ballots are revealed.</p>';
            return;
        }

        let html = '<table class="outcome-table">';
        html += '<thead><tr>';
        html += '<th>PR</th>';
        html += '<th>Your Confidence</th>';
        html += '<th>Outcome</th>';
        html += '<th>Accurate?</th>';
        html += '</tr></thead>';
        html += '<tbody>';

        for (const entry of history) {
            const accurateIcon = entry.accurate ? '✓' : '✗';
            const accurateClass = entry.accurate ? 'accurate' : 'inaccurate';
            const outcomeLabel = formatOutcomeType(entry.outcomeType);

            html += '<tr>';
            html += `<td>${escapeHtml(entry.prReference)}</td>`;
            html += `<td>${entry.confidence}/5</td>`;
            html += `<td>${outcomeLabel}</td>`;
            html += `<td class="${accurateClass}">${accurateIcon}</td>`;
            html += '</tr>';
        }

        html += '</tbody></table>';
        historyDiv.innerHTML = html;
    }

    /**
     * formats outcome type for display
     * @param {string} type - outcome type
     * @returns {string} formatted label
     */
    function formatOutcomeType(type) {
        const labels = {
            'merged_clean': 'Merged Clean',
            'bug_found': 'Bug Found',
            'reverted': 'Reverted',
            'followup_required': 'Follow-up Required'
        };
        return labels[type] || type;
    }

    // reflection tab functionality
    function initReflectionTab() {
        const filterButton = document.getElementById('filter-timeline');
        const clearButton = document.getElementById('clear-filters');
        const analyzePatternsButton = document.getElementById('analyze-patterns');
        const exportReportButton = document.getElementById('export-report');

        if (filterButton) {
            filterButton.addEventListener('click', () => {
                const startDate = document.getElementById('reflection-date-start').value;
                const endDate = document.getElementById('reflection-date-end').value;
                vscode.postMessage({
                    command: 'getReflectionTimeline',
                    filters: { start_date: startDate, end_date: endDate }
                });
            });
        }

        if (clearButton) {
            clearButton.addEventListener('click', () => {
                document.getElementById('reflection-date-start').value = '';
                document.getElementById('reflection-date-end').value = '';
                vscode.postMessage({
                    command: 'getReflectionTimeline',
                    filters: {}
                });
            });
        }

        if (analyzePatternsButton) {
            analyzePatternsButton.addEventListener('click', () => {
                vscode.postMessage({ command: 'analyzePatterns' });
            });
        }

        if (exportReportButton) {
            exportReportButton.addEventListener('click', () => {
                vscode.postMessage({ command: 'exportReport' });
            });
        }

        // decision scheme modal handlers
        const schemeSelect = document.getElementById('scheme-type');
        const customGroup = document.getElementById('custom-scheme-group');

        if (schemeSelect && customGroup) {
            schemeSelect.addEventListener('change', () => {
                customGroup.style.display = schemeSelect.value === 'custom' ? 'block' : 'none';
            });
        }

        const schemeForm = document.getElementById('decision-scheme-form');
        if (schemeForm) {
            schemeForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const formData = {
                    scheme_type: document.getElementById('scheme-type').value,
                    rationale: document.getElementById('scheme-rationale').value,
                    custom_scheme_name: document.getElementById('custom-scheme-name').value
                };
                vscode.postMessage({ command: 'saveDecisionScheme', data: formData });
            });
        }

        const schemeCancelButton = document.getElementById('scheme-cancel');
        if (schemeCancelButton) {
            schemeCancelButton.addEventListener('click', () => {
                const modal = document.getElementById('decision-scheme-modal');
                if (modal) {
                    modal.style.display = 'none';
                }
            });
        }

        // retrospective modal handlers
        const retroForm = document.getElementById('retrospective-form');
        if (retroForm) {
            retroForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const biases = Array.from(document.querySelectorAll('input[name="bias"]:checked'))
                    .map(cb => cb.value);

                const formData = {
                    what_went_wrong: document.getElementById('retro-what-wrong').value,
                    what_to_improve: document.getElementById('retro-what-improve').value,
                    bias_patterns: biases
                };
                vscode.postMessage({ command: 'saveRetrospective', data: formData });
            });
        }

        const retroDismissButton = document.getElementById('retro-dismiss');
        if (retroDismissButton) {
            retroDismissButton.addEventListener('click', () => {
                const modal = document.getElementById('retrospective-modal');
                if (modal) {
                    modal.style.display = 'none';
                }
            });
        }

        // other bias checkbox handler
        const otherBiasCheckbox = document.querySelector('input[name="bias"][value="other"]');
        const otherBiasGroup = document.getElementById('other-bias-group');
        if (otherBiasCheckbox && otherBiasGroup) {
            otherBiasCheckbox.addEventListener('change', () => {
                otherBiasGroup.style.display = otherBiasCheckbox.checked ? 'block' : 'none';
            });
        }

        // load initial data
        vscode.postMessage({ command: 'getReflectionTimeline', filters: {} });
    }

    /**
     * renders reflection timeline data
     * @param {Array} timeline - timeline entries
     */
    function renderReflectionTimeline(timeline) {
        const container = document.getElementById('decision-timeline');
        if (!container) return;

        if (!timeline || timeline.length === 0) {
            container.innerHTML = '<p class="placeholder-text">No decisions recorded yet</p>';
            return;
        }

        let html = '<table><thead><tr><th>PR</th><th>Date</th><th>Scheme</th><th>Outcome</th></tr></thead><tbody>';
        timeline.forEach(item => {
            const date = new Date(item.timestamp).toLocaleDateString();
            const schemeType = item.scheme?.scheme_type || 'N/A';
            html += `<tr>
                <td>${escapeHtml(item.pr_id)}</td>
                <td>${date}</td>
                <td>${escapeHtml(schemeType)}</td>
                <td>${escapeHtml(item.trigger_type)}</td>
            </tr>`;
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    }

    /**
     * renders pattern insights
     * @param {Array} insights - pattern analysis results
     */
    function renderPatternInsights(insights) {
        const container = document.getElementById('pattern-insights');
        if (!container) return;

        if (!insights || insights.length === 0) {
            container.innerHTML = '<p class="placeholder-text">No patterns detected</p>';
            return;
        }

        let html = '<ul>';
        insights.forEach(insight => {
            html += `<li><strong>${escapeHtml(insight.pattern)}</strong>: ${escapeHtml(insight.description)} (Evidence: ${escapeHtml(insight.evidence)})</li>`;
        });
        html += '</ul>';
        container.innerHTML = html;
    }

    // initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initTabs();
            initContextTab();
            initEvidenceTab();
            initEquityTab();
            initCalibrationTab();
            initReflectionTab();
        });
    } else {
        initTabs();
        initContextTab();
        initEvidenceTab();
        initEquityTab();
        initCalibrationTab();
        initReflectionTab();
    }
})();
