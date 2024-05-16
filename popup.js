document.addEventListener('DOMContentLoaded', () => {
  // Retrieve and initialize DOM elements
  const extensionList = document.getElementById('extensionList');
  const randomizeButton = document.getElementById('randomizeButton');
  const toggleAutoModIdentification = document.getElementById('toggleAutoModIdentification');
  const toggleRandomizeOnStartup = document.getElementById('toggleRandomizeOnStartup');
  const modForm = document.getElementById('modForm');

  // Event listeners for checkbox state changes and button clicks
  toggleAutoModIdentification.addEventListener('change', handleAutoModIdentificationChange);
  toggleRandomizeOnStartup.addEventListener('change', handleRandomizeOnStartupChange);
  modForm.addEventListener('submit', handleFormSubmission);
  randomizeButton.addEventListener('click', handleRandomizeButtonClick);

  // Retrieve saved state of checkboxes on popup open
  chrome.storage.local.get(
    ['autoModIdentificationChecked', 'toggleRandomizeOnStartupChecked'],
    ({ autoModIdentificationChecked = false, toggleRandomizeOnStartupChecked = false }) => {
      toggleAutoModIdentification.checked = autoModIdentificationChecked;
      toggleRandomizeOnStartup.checked = toggleRandomizeOnStartupChecked;

      autoModIdentificationChecked ? identifyModExtensions() : simplifiedUpdateCheckboxes();
    }
  );

  // Function to update checkboxes without additional variables
  function simplifiedUpdateCheckboxes() {
    chrome.management.getAll(extensions => {
      chrome.storage.local.get('modExtensionIds', ({ modExtensionIds = [] }) => {
        updateCheckboxes(extensions, modExtensionIds);
      });
    });
  }

  // Function to update checkboxes based on extension IDs
  function updateCheckboxes(extensions, modExtensionIds) {
    extensionList.innerHTML = ''; // Clear the existing content

    extensions
      .sort((a, b) => a.name.localeCompare(b.name)) // Sort extensions alphabetically
      .filter(extension => !['toggleAutoModIdentification', 'toggleRandomizeOnStartup'].includes(extension.id))
      .forEach(extension => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = extension.id;
        checkbox.checked = modExtensionIds.includes(extension.id);

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(extension.name));
        extensionList.appendChild(label);
      });
  }

  // Function to handle form submission
  function handleFormSubmission(event) {
    event.preventDefault();

    const modExtensionIds = Array.from(document.querySelectorAll('input[type="checkbox"]:checked'))
      .map(checkbox => checkbox.id)
      .filter(id => !['toggleAutoModIdentification', 'toggleRandomizeOnStartup'].includes(id));

    // Save the mod extension IDs to local storage
    chrome.storage.local.set({ modExtensionIds }, () => {
      console.log('Save button: modExtensionsSaved', modExtensionIds);
      window.close();
    });
  }

  // Function to handle "Randomize" button click
  function handleRandomizeButtonClick() {
    chrome.storage.local.get('modExtensionIds', ({ modExtensionIds }) => {
      if (modExtensionIds && modExtensionIds.length > 0) {
        disableAndEnableRandomExtension(modExtensionIds);
      } else {
        console.error('Error: mod extensions not found in local storage');
      }
    });
  }

  // Function to handle "Automatic Mod Identification" checkbox change
  function handleAutoModIdentificationChange() {
    const isChecked = toggleAutoModIdentification.checked;
    chrome.storage.local.set({ autoModIdentificationChecked: isChecked });
    console.log('Automatic Mod Identification set to', isChecked);
    isChecked ? identifyModExtensions() : simplifiedUpdateCheckboxes();
  }

  // Function to handle "Randomize on Startup" checkbox change
  function handleRandomizeOnStartupChange() {
    const randomizeOnStartup = toggleRandomizeOnStartup.checked;
    chrome.storage.local.set({ toggleRandomizeOnStartupChecked: randomizeOnStartup, randomizeOnStartup });
    console.log('Randomize on startup is set to', randomizeOnStartup);
  }

  // Function to automatically identify mod extensions and save them
  function identifyModExtensions() {
    chrome.management.getAll(extensions => {
      const modExtensionIds = extensions
        .filter(extension => extension.updateUrl === 'https://api.gx.me/store/mods/update')
        .map(extension => extension.id);

      updateCheckboxes(extensions, modExtensionIds);

      chrome.storage.local.set({ modExtensionIds }, () => {
        console.log('Automatic Mod Identification: Mod Extensions identified:', modExtensionIds);
      });
    });
  }

  // Function to disable and enable a random extension
  function disableAndEnableRandomExtension(modExtensionIds) {
    modExtensionIds.forEach(extensionId => {
      chrome.management.get(extensionId, extension => {
        const { id, name, enabled } = extension;
        chrome.management.setEnabled(extensionId, false, () => {
          console.log('Disabled Extension:', { id, name, enabled });
        });
      });
    });

    const randomExtensionId = modExtensionIds[Math.floor(Math.random() * modExtensionIds.length)];

    setTimeout(() => {
      chrome.management.get(randomExtensionId, extension => {
        const { id, name, enabled } = extension;
        chrome.management.setEnabled(randomExtensionId, true, () => {
          console.log('Enabled Random Extension:', { id, name, enabled });

          const messageElement = document.getElementById('message');
          messageElement.textContent = `Enabled Mod: ${extension.name}`;

          let hrElement = document.querySelector('hr');
          if (!hrElement) {
            hrElement = document.createElement('hr');
            messageElement.insertAdjacentElement('afterend', hrElement);
          }

          const redirectMessageElement = document.createElement('p');
          redirectMessageElement.textContent = 'Redirecting to enable checkmarks';
          redirectMessageElement.classList.add('redirect-message');
          hrElement.insertAdjacentElement('beforebegin', redirectMessageElement);

          let dots = '';
          const interval = setInterval(() => {
            redirectMessageElement.textContent = `Redirecting to enable checkmarks${dots}`;
            dots += '.';
            if (dots.length > 3) {
              dots = '.';
            }
          }, 500);

          setTimeout(() => {
            clearInterval(interval);
            chrome.tabs.create({ url: 'opera://mods' });
          }, 5000);
        });
      });
    }, 100);
  }
});
