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

    console.log('Mod Randomizer: Startup detected. Mod Extensions retrieved and identified:', modExtensions);

    if (modExtensions.length > 0) {
      // Randomly select a mod extension
      const randomIndex = Math.floor(Math.random() * modExtensions.length);
      const selectedExtension = modExtensions[randomIndex];
      console.log('Mod Randomizer: Randomly selected mod extension:', selectedExtension);

      // Disable all mod extensions except the randomly selected one
      modExtensions.forEach(extension => {
        if (extension.id !== selectedExtension.id) {
          chrome.management.setEnabled(extension.id, false, () => {
            logExtensionState('Disabled Extension', extension);
          });
        }
      });

      // Enable the randomly selected mod extension
      if (!selectedExtension.enabled) {
        chrome.management.setEnabled(selectedExtension.id, true, () => {
          logExtensionState('Enabled selected mod extension', selectedExtension);
        });
      }
    }
  });
}

// Function to log the state of extensions
function logExtensionState(action, extension) {
  const { id, name, enabled } = extension;
  console.log(action, { id, name, enabled });
}
