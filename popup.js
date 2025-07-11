document.addEventListener('DOMContentLoaded', () => {
    const extensionList = document.getElementById('extensionList');
    const randomizeButton = document.getElementById('randomizeButton');
    const toggleAutoModIdentification = document.getElementById('toggleAutoModIdentification');
    const toggleRandomizeOnStartup = document.getElementById('toggleRandomizeOnStartup');
    const toggleOpenModsTab = document.getElementById('toggleOpenModsTab');
    const toggleRandomizeOnSetTime = document.getElementById('toggleRandomizeOnSetTime');
    const timeInput = document.getElementById('timeInput');
    const timeUnitSelect = document.getElementById('timeUnitSelect');
    const modForm = document.getElementById('modForm');
    const messageElement = document.getElementById('message');
    const searchBar = document.getElementById('searchBar');
    let redirectTimeout;

    // Function to update the currentMod element
    function updateCurrentMod() {
        chrome.storage.local.get('currentMod', ({ currentMod }) => {
            const currentModElement = document.getElementById('current-mod');
            if (currentModElement) {
                currentModElement.textContent = `Current Mod: ${currentMod || 'None'}`;
            }
        });
    }

    // Update currentMod on popup load
    updateCurrentMod();

    // Store initial time unit as previous unit for future reference
    chrome.storage.local.get('timeUnit', ({ timeUnit = 'minutes' }) => {
        timeUnitSelect.dataset.previousUnit = timeUnit;
    });

    // Listen for storage changes to update the currentMod element
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.currentMod) {
            updateCurrentMod();
        }
    });

    // Prevent default form submission when pressing Enter.
    modForm.addEventListener('submit', (e) => e.preventDefault());

    addEventListeners();
    initializeCheckboxStates();

    // When the popup opens, send a "popupOpened" message to the background.
    // The background will trigger mod identification if the setting is enabled.
    chrome.runtime.sendMessage({ action: 'popupOpened' }, (response) => {
        if (response && response.status === 'success') {
            updateCheckboxes();
        }
    });

    function addEventListeners() {
        toggleAutoModIdentification.addEventListener('change', () =>
            handleCheckboxChange('autoModIdentificationChecked', toggleAutoModIdentification.checked)
        );
        toggleRandomizeOnStartup.addEventListener('change', () =>
            handleCheckboxChange('toggleRandomizeOnStartupChecked', toggleRandomizeOnStartup.checked)
        );
        toggleOpenModsTab.addEventListener('change', () =>
            handleCheckboxChange('toggleOpenModsTabChecked', toggleOpenModsTab.checked)
        );
        toggleRandomizeOnSetTime.addEventListener('change', () =>
            handleCheckboxChange('toggleRandomizeOnSetTimeChecked', toggleRandomizeOnSetTime.checked)
        );
        // Use "change" so we don't schedule multiple timeouts while typing.
        timeInput.addEventListener('change', handleTimeInputChange);
        timeUnitSelect.addEventListener('change', handleTimeUnitChange);
        extensionList.addEventListener('change', handleExtensionListChange);
        randomizeButton.addEventListener('click', handleRandomizeButtonClick);
        searchBar.addEventListener('input', handleSearchInput);
    }

    function initializeCheckboxStates() {
        chrome.storage.local.get(
            [
                'autoModIdentificationChecked',
                'toggleRandomizeOnStartupChecked',
                'toggleOpenModsTabChecked',
                'toggleRandomizeOnSetTimeChecked',
                'randomizeTime',
                'timeUnit'
            ],
            ({
                autoModIdentificationChecked = false,
                toggleRandomizeOnStartupChecked = false,
                toggleOpenModsTabChecked = true,
                toggleRandomizeOnSetTimeChecked = false,
                randomizeTime = 0,
                timeUnit = 'minutes'
            }) => {
                toggleAutoModIdentification.checked = autoModIdentificationChecked;
                toggleRandomizeOnStartup.checked = toggleRandomizeOnStartupChecked;
                toggleOpenModsTab.checked = toggleOpenModsTabChecked;
                toggleRandomizeOnSetTime.checked = toggleRandomizeOnSetTimeChecked;

                // Convert stored minutes back to the selected time unit
                if (randomizeTime > 0) {
                    timeInput.value = convertFromMinutes(randomizeTime, timeUnit);
                } else {
                    timeInput.value = '';
                }

                timeUnitSelect.value = timeUnit;
                updateCheckboxes();
            }
        );
    }

    function handleExtensionListChange() {
        if (toggleAutoModIdentification.checked) {
            alert('Auto Mod Identification is currently enabled.');
            return;
        }
        const modExtensionIds = Array.from(document.querySelectorAll('input[type="checkbox"]:checked'))
            .map(checkbox => checkbox.id)
            .filter(id =>
                ![
                    'toggleAutoModIdentification',
                    'toggleRandomizeOnStartup',
                    'toggleOpenModsTab',
                    'toggleRandomizeOnSetTime'
                ].includes(id)
            );

        sendMessageToBackground('saveModExtensionIds', { modExtensionIds });
    }

    function handleRandomizeButtonClick() {
     randomizeMods();
    }

    function randomizeMods() {
        sendMessageToBackground('randomizeMods', {}, (response) => {
            if (response && response.status === 'success') {
                showEnabledMessage(response.enabledExtension);
            } else {
                console.error('Randomization failed:', response && response.message);
            }
        });
        removeRedirectMessage();
    }

    function handleSearchInput() {
        const query = searchBar.value.toLowerCase();
        const listItems = extensionList.getElementsByTagName('li');
        Array.from(listItems).forEach(li => {
            const text = li.textContent.toLowerCase();
            li.style.display = text.includes(query) ? '' : 'none';
        });
    }

    function handleTimeInputChange() {
        const inputValue = parseFloat(timeInput.value);
        const timeUnit = timeUnitSelect.value;

        if (isNaN(inputValue) || inputValue === 0 || inputValue === '') {
            // Treat empty input as 0  
            messageElement.textContent = '';
            sendMessageToBackground('setRandomizeTime', { time: 0 });
            return;
        }

        // Allow 0.25 for testing purposes when unit is minutes
        if (timeUnit === 'minutes' && inputValue === 0.25) {
            // Special case: allow 0.25 minutes for testing
            let timeInMinutes = convertToMinutes(inputValue, timeUnit);
            messageElement.textContent = '';
            sendMessageToBackground('setRandomizeTime', { time: timeInMinutes });
            return;
        }

        // Validate minimum values based on unit before conversion
        let minValueMessage = '';
        if (timeUnit === 'minutes' && inputValue < 1) {
            minValueMessage = 'Randomize time must be at least 1 minute (or 0.25 for testing) or 0 to disable.';
        } else if ((timeUnit === 'hours' || timeUnit === 'days') && inputValue < 1) {
            minValueMessage = `Randomize time must be at least 1 ${timeUnit} or 0 to disable.`;
        }

        if (minValueMessage) {
            alert(minValueMessage);
            return;
        }

        // Convert to minutes based on selected unit
        let timeInMinutes = convertToMinutes(inputValue, timeUnit);

        messageElement.textContent = '';
        sendMessageToBackground('setRandomizeTime', { time: timeInMinutes });
    }

    function handleTimeUnitChange() {
        const oldUnit = timeUnitSelect.dataset.previousUnit || 'minutes';
        const newUnit = timeUnitSelect.value;

        // Update the previous unit data attribute
        timeUnitSelect.dataset.previousUnit = newUnit;

        // Store the new time unit in local storage
        chrome.storage.local.set({ timeUnit: newUnit }, () => {
            console.log(`Time unit set to ${newUnit}`);

            // If there's a value in the time input, convert it to the new unit
            if (timeInput.value && timeInput.value !== '') {
                // First convert current display value to minutes based on old unit
                const valueInMinutes = convertToMinutes(parseFloat(timeInput.value), oldUnit);

                // Then convert from minutes to the new unit
                timeInput.value = convertFromMinutes(valueInMinutes, newUnit);
            }
        });
    }

    function convertToMinutes(value, unit) {
        switch (unit) {
            case 'minutes':
                return value;
            case 'hours':
                return value * 60;
            case 'days':
                return value * 24 * 60;
            default:
                return value;
        }
    }

    function convertFromMinutes(minutes, unit) {
        switch (unit) {
            case 'minutes':
                return minutes;
            case 'hours':
                return (minutes / 60).toFixed(2);
            case 'days':
                return (minutes / (24 * 60)).toFixed(2);
            default:
                return minutes;
        }
    }

    function updateCheckboxes(callback) {
        chrome.runtime.sendMessage({ action: 'getExtensions' }, ({ extensions, modExtensionIds, autoModIdentificationChecked }) => {
            extensionList.innerHTML = '';
            extensions
                .sort((a, b) => a.name.localeCompare(b.name))
                .forEach(extension => {
                    const li = createCheckboxListItem(extension, modExtensionIds.includes(extension.id), autoModIdentificationChecked);
                    extensionList.appendChild(li);
                });
            if (callback) callback();
        });
    }

    function createCheckboxListItem(extension, isChecked, autoModIdentificationChecked) {
        const li = document.createElement('li');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = extension.id;
        checkbox.checked = isChecked;
        checkbox.disabled = autoModIdentificationChecked;
        li.appendChild(checkbox);
        li.appendChild(document.createTextNode(extension.name));
        return li;
    }

    function sendMessageToBackground(action, data = {}, callback) {
        chrome.runtime.sendMessage({ action, ...data }, (response) => {
            if (chrome.runtime.lastError) {
                console.error(chrome.runtime.lastError);
            } else {
                console.log(`Background response: ${response && response.status}`);
                if (callback) callback(response);
            }
        });
    }

    function handleCheckboxChange(key, value) {
        chrome.storage.local.set({ [key]: value }, () => {
            console.log(`${key} set to ${value}`);
            if (key === 'autoModIdentificationChecked') {
                if (value) {
                    sendMessageToBackground('identifyModExtensions', {}, () => updateCheckboxes());
                } else {
                    updateCheckboxes();
                }
                document.querySelectorAll('#extensionList input[type="checkbox"]').forEach(checkbox => {
                    checkbox.disabled = value;
                });
            } else if (key === 'toggleRandomizeOnSetTimeChecked') {
                sendMessageToBackground('toggleRandomizeOnSetTimeChecked', { value });
            }
        });
    }

    // --- Always create the HR element in showEnabledMessage ---
    function showEnabledMessage(extension) {
        removeRedirectMessage();

        // Create or update the HR element right after the randomize button.
        let hrElement = document.getElementById('message-hr');
        if (!hrElement) {
            hrElement = document.createElement('hr');
            hrElement.id = 'message-hr';
            randomizeButton.insertAdjacentElement('afterend', hrElement);
        }

        // Remove any existing enabled message.
        let enabledMessageElement = document.getElementById('enabledMessage');
        if (enabledMessageElement) {
            enabledMessageElement.remove();
        }
        enabledMessageElement = document.createElement('div');
        enabledMessageElement.id = 'enabledMessage';
        enabledMessageElement.innerHTML = `Enabled Mod: <span class="mod-name">${extension.name}</span>`;

        // Insert the enabled message after the HR element.
        hrElement.insertAdjacentElement('afterend', enabledMessageElement);

        chrome.storage.local.get('toggleOpenModsTabChecked', ({ toggleOpenModsTabChecked }) => {
            if (toggleOpenModsTabChecked) {
                addRedirectMessage();
            }
        });
    }

    function addRedirectMessage() {
        // Get the enabled message element so the redirect is inserted right below it.
        let enabledMessageElement = document.getElementById('enabledMessage');
        if (enabledMessageElement) {
            const redirectMessageElement = document.createElement('p');
            redirectMessageElement.textContent = 'Redirecting to enable checkmarks';
            redirectMessageElement.classList.add('redirect-message');
            enabledMessageElement.insertAdjacentElement('afterend', redirectMessageElement);
            animateRedirectMessage(redirectMessageElement);
        }
    }

    function animateRedirectMessage(element) {
        let dots = '';
        const interval = setInterval(() => {
            dots = dots.length < 3 ? dots + '.' : '';
            element.textContent = `Redirecting to enable checkmarks${dots}`;
        }, 300);
        element.dataset.intervalId = interval;
    }

    function removeRedirectMessage() {
        // Remove any redirect message element and clear its interval.
        document.querySelectorAll('.redirect-message').forEach(element => {
            if (element.dataset.intervalId) {
                clearInterval(parseInt(element.dataset.intervalId));
            }
            element.remove();
        });
        // Remove the HR line if present.
        const hrElement = document.getElementById('message-hr');
        if (hrElement) {
            hrElement.remove();
        }
        // Remove the enabled message.
        const enabledMessageElement = document.getElementById('enabledMessage');
        if (enabledMessageElement) {
            enabledMessageElement.remove();
        }
    }

    // Listen for background messages (when randomization completes)
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'randomizationCompleted') {
            showEnabledMessage(message.enabledExtension);
        }
    });
});