document.addEventListener('DOMContentLoaded', () => {
  const extensionList = document.getElementById('extensionList');
  const randomizeButton = document.getElementById('randomizeButton');
  const toggleAutoModIdentification = document.getElementById('toggleAutoModIdentification');
  const toggleRandomizeOnStartup = document.getElementById('toggleRandomizeOnStartup');
  const modForm = document.getElementById('modForm');
  const messageElement = document.getElementById('message');

  let randomizeTimeout;
  let redirectTimeout;

  addEventListeners();
  initializeCheckboxStates();

  function addEventListeners() {
    toggleAutoModIdentification.addEventListener('change', handleAutoModIdentificationChange);
    toggleRandomizeOnStartup.addEventListener('change', handleRandomizeOnStartupChange);
    modForm.addEventListener('submit', handleFormSubmission);
    randomizeButton.addEventListener('click', handleRandomizeButtonClick);
  }

  function initializeCheckboxStates() {
    chrome.storage.local.get(
      ['autoModIdentificationChecked', 'toggleRandomizeOnStartupChecked'],
      ({ autoModIdentificationChecked = false, toggleRandomizeOnStartupChecked = false }) => {
        toggleAutoModIdentification.checked = autoModIdentificationChecked;
        toggleRandomizeOnStartup.checked = toggleRandomizeOnStartupChecked;

        if (autoModIdentificationChecked) {
          identifyModExtensions();
        } else {
          updateCheckboxes();
        }
      }
    );
  }

  function updateCheckboxes() {
    chrome.management.getAll(extensions => {
      chrome.storage.local.get(['modExtensionIds', 'autoModIdentificationChecked'], ({ modExtensionIds = [], autoModIdentificationChecked }) => {
        extensionList.innerHTML = '';
        extensions
          .sort((a, b) => a.name.localeCompare(b.name))
          .filter(extension => !['toggleAutoModIdentification', 'toggleRandomizeOnStartup'].includes(extension.id))
          .forEach(extension => {
            const li = createCheckboxListItem(extension, modExtensionIds.includes(extension.id), autoModIdentificationChecked);
            extensionList.appendChild(li);
          });
      });
    });
  }

  function createCheckboxListItem(extension, isChecked, autoModIdentificationChecked) {
    const li = document.createElement('li');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = extension.id;
    checkbox.checked = isChecked;
    checkbox.disabled = autoModIdentificationChecked; // Disable checkbox based on setting

    li.appendChild(checkbox);
    li.appendChild(document.createTextNode(extension.name));
    return li;
  }

  function handleFormSubmission(event) {
    event.preventDefault();
    if (toggleAutoModIdentification.checked) {
      alert('Auto Mod Identification is currently enabled.');
      return;
    }
    const modExtensionIds = Array.from(document.querySelectorAll('input[type="checkbox"]:checked'))
      .map(checkbox => checkbox.id)
      .filter(id => !['toggleAutoModIdentification', 'toggleRandomizeOnStartup'].includes(id));

    saveModExtensionIds(modExtensionIds);
  }

  function saveModExtensionIds(modExtensionIds) {
    chrome.storage.local.set({ modExtensionIds }, () => {
      console.log('Mod extensions saved:', modExtensionIds);
      window.close();
    });
  }

  function handleRandomizeButtonClick() {
    if (randomizeTimeout) {
      clearTimeout(randomizeTimeout);
    }
    if (redirectTimeout) {
      clearTimeout(redirectTimeout);
    }
    removeRedirectMessage();
    chrome.storage.local.get('modExtensionIds', ({ modExtensionIds }) => {
      if (modExtensionIds && modExtensionIds.length > 0) {
        disableAndEnableRandomExtension(modExtensionIds);
      } else {
        console.error('Error: Mod extensions not found in local storage');
      }
    });
  }

  function handleAutoModIdentificationChange() {
    const isChecked = toggleAutoModIdentification.checked;
    chrome.storage.local.set({ autoModIdentificationChecked: isChecked }, () => {
      console.log('Automatic Mod Identification set to', isChecked);
      if (isChecked) {
        identifyModExtensions();
      } else {
        updateCheckboxes();
      }
    });
  }

  function handleRandomizeOnStartupChange() {
    const isChecked = toggleRandomizeOnStartup.checked;
    chrome.storage.local.set({ toggleRandomizeOnStartupChecked: isChecked }, () => {
      console.log('Randomize on startup is set to', isChecked);
    });
  }

  function identifyModExtensions() {
    chrome.management.getAll(extensions => {
      const modExtensionIds = extensions
        .filter(extension => extension.updateUrl === 'https://api.gx.me/store/mods/update')
        .map(extension => extension.id);

      updateCheckboxes();

      chrome.storage.local.set({ modExtensionIds }, () => {
        console.log('Mod extensions identified:', modExtensionIds);
      });
    });
  }

  function disableAndEnableRandomExtension(modExtensionIds) {
    modExtensionIds.forEach(extensionId => {
      chrome.management.get(extensionId, extension => {
        chrome.management.setEnabled(extensionId, false, () => {
          logExtensionState('Disabled Extension', extension);
        });
      });
    });

    const randomExtensionId = modExtensionIds[Math.floor(Math.random() * modExtensionIds.length)];

    randomizeTimeout = setTimeout(() => {
      chrome.management.get(randomExtensionId, extension => {
        chrome.management.setEnabled(randomExtensionId, true, () => {
          logExtensionState('Enabled Random Extension', extension);
          showEnabledMessage(extension);
        });
      });
    }, 100);
  }

  function logExtensionState(action, extension) {
    console.log(`${action}: ${extension.name}`);
  }

  function showEnabledMessage(extension) {
    const messageElement = document.getElementById('message');

    removeRedirectMessage();
    removePreviousHr();

    messageElement.innerHTML = `Enabled Mod: <span class="mod-name">${extension.name}</span>`;
    messageElement.classList.add('highlighted-message');

    let hrElement = document.createElement('hr');
    hrElement.id = 'message-hr';
    messageElement.insertAdjacentElement('afterend', hrElement);

    addRedirectMessage();
    redirectTimeout = setTimeout(() => {
      chrome.tabs.create({ url: 'opera://mods' });
    }, 5000);
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

  function removeRedirectMessage() {
    const redirectMessageElements = document.querySelectorAll('.redirect-message');
    redirectMessageElements.forEach(element => element.remove());

    removePreviousHr();
  }

  function removePreviousHr() {
    const hrElement = document.querySelector('#message-hr');
    if (hrElement) hrElement.remove();
  }

  function animateRedirectMessage(element) {
    let dots = '';
    setInterval(() => {
      dots = dots.length < 3 ? dots + '.' : '';
      element.textContent = `Redirecting to enable checkmarks${dots}`;
    }, 300);
  }
});
