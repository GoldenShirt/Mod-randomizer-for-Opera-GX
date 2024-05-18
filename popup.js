document.addEventListener('DOMContentLoaded', () => {
  const extensionList = document.getElementById('extensionList');
  const randomizeButton = document.getElementById('randomizeButton');
  const toggleAutoModIdentification = document.getElementById('toggleAutoModIdentification');
  const toggleRandomizeOnStartup = document.getElementById('toggleRandomizeOnStartup');
  const modForm = document.getElementById('modForm');
  const messageElement = document.getElementById('message');

  let randomizeTimeout; // Declare randomizeTimeout at the appropriate scope level
  let redirectTimeout; // Declare redirectTimeout for handling redirection

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
      chrome.storage.local.get('modExtensionIds', ({ modExtensionIds = [] }) => {
        extensionList.innerHTML = '';
        extensions
          .sort((a, b) => a.name.localeCompare(b.name))
          .filter(extension => !['toggleAutoModIdentification', 'toggleRandomizeOnStartup'].includes(extension.id))
          .forEach(extension => {
            const label = createCheckboxLabel(extension, modExtensionIds.includes(extension.id));
            extensionList.appendChild(label);
          });
      });
    });
  }

  function createCheckboxLabel(extension, isChecked) {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = extension.id;
    checkbox.checked = isChecked;

    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(extension.name));
    return label;
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
    messageElement.innerHTML = `Enabled Mod: <span class="mod-name">${extension.name}</span>`;
    messageElement.classList.add('highlighted-message');
    addRedirectMessage();
    redirectTimeout = setTimeout(() => {
      chrome.tabs.create({ url: 'opera://mods' });
    }, 5000); // Assign timeout to redirectTimeout
  }

  function addRedirectMessage() {
    let hrElement = document.querySelector('hr');
    if (!hrElement) {
      hrElement = document.createElement('hr');
      messageElement.insertAdjacentElement('afterend', hrElement);
    }

    const redirectMessageElement = document.createElement('p');
    redirectMessageElement.textContent = 'Redirecting to enable checkmarks';
    redirectMessageElement.classList.add('redirect-message');
    hrElement.insertAdjacentElement('beforebegin', redirectMessageElement);

    animateRedirectMessage(redirectMessageElement);
  }

  function removeRedirectMessage() {
    const redirectMessageElements = document.querySelectorAll('.redirect-message');
    redirectMessageElements.forEach(element => element.remove());
  }

  function animateRedirectMessage(element) {
    let dots = '';
    const interval = setInterval(() => {
      element.textContent = `Redirecting to enable checkmarks${dots}`;
      dots += '.';
      if (dots.length > 3) {
        dots = '.';
      }
    }, 500);

    setTimeout(() => {
      clearInterval(interval);
    }, 5000);
  }
});
