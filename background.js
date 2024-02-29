let randomizeOnStartup;

chrome.runtime.onInstalled.addListener(function () {
  // Set initial values for extension settings in storage
  randomizeOnStartup = true;

  const initialSettings = {
    modExtensionIds: [],
    randomizeOnStartup: randomizeOnStartup,
    toggleRandomizeOnStartupChecked: randomizeOnStartup,
    autoModIdentificationChecked: true,
  };

  chrome.storage.local.set(initialSettings, function () {
    console.log('Mod Randomizer: Extension installed. Initializing settings.', initialSettings);
  });
});

chrome.runtime.onStartup.addListener(runStartupLogic);

function runStartupLogic() {
  // Use a default value if randomizeOnStartup is not defined
  randomizeOnStartup = randomizeOnStartup ?? true;

  console.log('After setting default: randomizeOnStartup is set to ', randomizeOnStartup);

  chrome.storage.local.get({ randomizeOnStartup: randomizeOnStartup, modExtensionIds: [] }, function (result) {
    randomizeOnStartup = result.randomizeOnStartup;
    console.log('Result startup setting overriding default: set to ', randomizeOnStartup);

    if (randomizeOnStartup) {
  // Retrieve mod extension IDs from local storage
  const modExtensionIds = result.modExtensionIds || [];

  // Get all installed extensions
  chrome.management.getAll(extensions => {
    // Filter for mod extensions based on stored IDs
    const modExtensions = extensions
      .filter(extension => modExtensionIds.includes(extension.id))
      .map(({ id, name, enabled }) => ({ id, name, enabled }));

    console.log('Mod Randomizer: Startup detected. Mod Extensions retrieved and identified:', modExtensions);

    if (modExtensions.length > 0) {
      // Randomly select a mod extension
      const randomIndex = Math.floor(Math.random() * modExtensions.length);
      const selectedExtension = modExtensions[randomIndex];
      console.log('Mod Randomizer: Randomly selected mod extension:', selectedExtension);

      // Disable all mod extensions sequentially
      modExtensions.forEach(extension => {
        if (extension.id !== selectedExtension.id) {
          chrome.management.setEnabled(extension.id, false, () => {
            console.log('Mod Randomizer: Disabled mod extension:', { id: extension.id, name: extension.name, enabled: extension.enabled });
          });
        }
      });

      // Enable the randomly selected mod extension
      if (!selectedExtension.enabled) {
        chrome.management.setEnabled(selectedExtension.id, true, () => {
          console.log('Mod Randomizer: Enabled selected mod extension:', { id: selectedExtension.id, name: selectedExtension.name, enabled: selectedExtension.enabled });
        });
      }
    }
  });
}

  });
}
