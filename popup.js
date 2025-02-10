document.addEventListener('DOMContentLoaded', () => {
    const extensionList = document.getElementById('extensionList');
    const randomizeButton = document.getElementById('randomizeButton');
    const toggleAutoModIdentification = document.getElementById('toggleAutoModIdentification');
    const toggleRandomizeOnStartup = document.getElementById('toggleRandomizeOnStartup');
    const modForm = document.getElementById('modForm');
    const messageElement = document.getElementById('message');
    const searchBar = document.getElementById('searchBar');
    let randomizeTimeout;
    let redirectTimeout;

    addEventListeners();
    initializeCheckboxStates();

    function addEventListeners() {
        toggleAutoModIdentification.addEventListener('change', () => handleCheckboxChange('autoModIdentificationChecked', toggleAutoModIdentification.checked));
        toggleRandomizeOnStartup.addEventListener('change', () => handleCheckboxChange('toggleRandomizeOnStartupChecked', toggleRandomizeOnStartup.checked));
        extensionList.addEventListener('change', handleExtensionListChange);
        randomizeButton.addEventListener('click', () => handleRandomizeButtonClick());
        searchBar.addEventListener('input', handleSearchInput);
    }

    function initializeCheckboxStates() {
        chrome.storage.local.get(
            ['autoModIdentificationChecked', 'toggleRandomizeOnStartupChecked'],
            ({ autoModIdentificationChecked = false, toggleRandomizeOnStartupChecked = false }) => {
                toggleAutoModIdentification.checked = autoModIdentificationChecked;
                toggleRandomizeOnStartup.checked = toggleRandomizeOnStartupChecked;
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
            .filter(id => !['toggleAutoModIdentification', 'toggleRandomizeOnStartup'].includes(id));

        sendMessageToBackground('saveModExtensionIds', { modExtensionIds });
    }

    function handleRandomizeButtonClick() {
        sendMessageToBackground('randomizeMods', {}, (response) => {
            if (response && response.status === 'success') {
                const enabledExtension = response.enabledExtension;
                if (enabledExtension) {
                    showEnabledMessage(enabledExtension);
                } else {
                    console.error('No extension was enabled.');
                }
            } else if (response && response.status === 'error') {
                console.error(response.message);
            }
        });
        if (randomizeTimeout) {
            clearTimeout(randomizeTimeout);
        }
        if (redirectTimeout) {
            clearTimeout(redirectTimeout);
        }
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

    function updateExtensionList(extensions) {
        chrome.storage.local.get(['modExtensionIds', 'autoModIdentificationChecked'], ({ modExtensionIds = [], autoModIdentificationChecked }) => {
            extensionList.innerHTML = '';
            extensions
                .sort((a, b) => a.name.localeCompare(b.name))
                .forEach(extension => {
                    const li = createCheckboxListItem(extension, modExtensionIds.includes(extension.id), autoModIdentificationChecked);
                    extensionList.appendChild(li);
                });
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

    // popup.js
    function sendMessageToBackground(action, data = {}, callback) {
        chrome.runtime.sendMessage({ action, ...data }, (response) => {
            if (chrome.runtime.lastError) {
                console.error(chrome.runtime.lastError);
            } else {
                console.log(`Background response: ${response.status}`);
                if (callback) callback(response);
            }
        });
    }

    function handleCheckboxChange(key, value) {
        chrome.storage.local.set({ [key]: value }, () => {
            console.log(`${key} set to ${value}`);
            if (key === 'autoModIdentificationChecked') {
                if (value) {
                    sendMessageToBackground('identifyModExtensions', {}, (response) => {
                        updateCheckboxes(() => {
                            // Reapply the current search filter after updating
                            handleSearchInput();
                        });
                    });
                } else {
                    updateCheckboxes(() => {
                        handleSearchInput();
                    });
                }
                // Disable/enable checkboxes immediately
                const checkboxes = document.querySelectorAll('#extensionList input[type="checkbox"]');
                checkboxes.forEach(checkbox => {
                    checkbox.disabled = value;
                });
            }
        });
    }


    function addRedirectMessage() {
        const messageElement = document.getElementById('message');
        const hrElement = document.getElementById('message-hr');

        const redirectMessageElement = document.createElement('p');
        redirectMessageElement.textContent = 'Redirecting to enable checkmarks';
        redirectMessageElement.classList.add('redirect-message');

        hrElement.insertAdjacentElement('beforebegin', redirectMessageElement);

        animateRedirectMessage(redirectMessageElement);
    }

    function animateRedirectMessage(element) {
        let dots = '';
        setInterval(() => {
            dots = dots.length < 3 ? dots + '.' : '';
            element.textContent = `Redirecting to enable checkmarks${dots}`;
        }, 300);
    }

    function showEnabledMessage(extension) {
        const messageElement = document.getElementById('message');
        removeRedirectMessage();
        messageElement.innerHTML = `Enabled Mod: <span class="mod-name">${extension.name}</span>`;
        messageElement.classList.add('highlighted-message');

        // Check if the hr element already exists
        let hrElement = document.getElementById('message-hr');
        if (!hrElement) {
            // If it doesn't exist, create it
            hrElement = document.createElement('hr');
            hrElement.id = 'message-hr';
            messageElement.insertAdjacentElement('afterend', hrElement);
        }

        addRedirectMessage();
        redirectTimeout = setTimeout(() => {
            chrome.tabs.create({ url: 'opera://mods/manage' });
            removeRedirectMessage();
        }, 5000);
    }

    function removeRedirectMessage() {
        const redirectMessageElements = document.querySelectorAll('.redirect-message');
        redirectMessageElements.forEach(element => element.remove());
    }

    function removePreviousHr() {
        const hrElement = document.querySelector('#message-hr');
        if (hrElement) hrElement.remove();
    }

});
