// Background script for the extension
chrome.runtime.onInstalled.addListener(() => {
  // Set initial values for extension settings in storage
  const initialSettings = {
    modExtensionIds: [],
    toggleRandomizeOnStartupChecked: true,
    autoModIdentificationChecked: true,
  };

  chrome.storage.local.set(initialSettings, () => {
    console.log('Mod Randomizer: Extension installed. Initializing settings.', initialSettings);
  });
});

chrome.runtime.onStartup.addListener(runStartupLogic);

// Function to execute startup logic
function runStartupLogic() {
  chrome.storage.local.get(['toggleRandomizeOnStartupChecked', 'modExtensionIds'], ({ toggleRandomizeOnStartupChecked, modExtensionIds = [] }) => {
    console.log('Startup setting: Randomize on startup is set to', toggleRandomizeOnStartupChecked);

    if (toggleRandomizeOnStartupChecked) {
      handleModExtensions(modExtensionIds);
    }
  });
}

// Function to handle enabling/disabling mod extensions
function handleModExtensions(modExtensionIds) {
  chrome.management.getAll(extensions => {
    // Filter for mod extensions based on stored IDs
    const modExtensions = extensions.filter(extension => modExtensionIds.includes(extension.id));

    console.log('Mod Randomizer: Mod Extensions retrieved:', modExtensions);

    if (modExtensions.length > 0) {
      // Disable all mod extensions
      modExtensions.forEach(extension => {
        if (extension.enabled) {
          chrome.management.setEnabled(extension.id, false, () => {
            logExtensionState('Disabled Extension', extension);
          });
        }
      });

      // Select a mod randomly that is currently disabled
      const disabledMods = modExtensions.filter(extension => !extension.enabled);

      if (disabledMods.length > 0) {
        const randomIndex = Math.floor(Math.random() * disabledMods.length);
        const selectedExtension = disabledMods[randomIndex];
        console.log('Mod Randomizer: Randomly selected mod extension:', selectedExtension);

        // Enable the randomly selected mod extension
        chrome.management.setEnabled(selectedExtension.id, true, () => {
          logExtensionState('Enabled selected mod extension', selectedExtension);
        });
      } else {
        console.log('Mod Randomizer: No disabled mods to enable.');
      }
    }
  });
}

// Function to log the state of extensions
function logExtensionState(action, extension) {
  const { id, name, enabled } = extension;
  console.log(action, { id, name, enabled });
}
