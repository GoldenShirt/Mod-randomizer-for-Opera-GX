let randomizeOnStartup;

chrome.runtime.onInstalled.addListener(() => {
  // Set initial values for extension settings in storage
  randomizeOnStartup = true;

  const initialSettings = {
    modExtensionIds: [],
    randomizeOnStartup: true,
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
  // Ensure randomizeOnStartup has a default value
  randomizeOnStartup = randomizeOnStartup ?? true;
  console.log('After setting default: randomizeOnStartup is set to', randomizeOnStartup);

  chrome.storage.local.get({ randomizeOnStartup, modExtensionIds: [] }, ({ randomizeOnStartup, modExtensionIds }) => {
    console.log('Result startup setting overriding default: set to', randomizeOnStartup);

    if (randomizeOnStartup) {
      // Get all installed extensions and handle mod extensions
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
            console.log('Mod Randomizer: Disabled mod extension:', extension);
          });
        }
      });

      // Enable the randomly selected mod extension
      if (!selectedExtension.enabled) {
        chrome.management.setEnabled(selectedExtension.id, true, () => {
          console.log('Mod Randomizer: Enabled selected mod extension:', selectedExtension);
        });
      }
    }
  });
}
