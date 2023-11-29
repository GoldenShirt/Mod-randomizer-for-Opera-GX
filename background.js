chrome.runtime.onInstalled.addListener(function () {
  // Set initial value for modExtensionIds in storage
  chrome.storage.local.set({ modExtensionIds: [] }, function () {
    console.log('Mod Randomizer: Extension installed. Initializing settings.');
  });
});



chrome.runtime.onStartup.addListener(async function() {
  // Retrieve mod extension IDs from local storage
  const result = await new Promise((resolve) => {
    chrome.storage.local.get('modExtensionIds', resolve);
  });

  const modExtensionIds = result.modExtensionIds || [];

  // Get all installed extensions
  const extensions = await new Promise((resolve) => {
    chrome.management.getAll(resolve);
  });

  // Filter for mod extensions based on stored IDs
  const modExtensions = extensions.filter(extension => modExtensionIds.includes(extension.id));

  console.log('Mod Randomizer: Mod Extensions identified:', modExtensions);

  if (modExtensions.length > 0) {
    // Randomly select a mod extension
    const randomIndex = Math.floor(Math.random() * modExtensions.length);
    const selectedExtension = modExtensions[randomIndex];
    console.log('Mod Randomizer: Randomly selected mod extension:', selectedExtension);

    // Disable all mod extensions sequentially
    for (const extension of modExtensions) {
      if (extension.id !== selectedExtension.id) {
        await new Promise((resolve) => {
          chrome.management.setEnabled(extension.id, false, function() {
            console.log('Mod Randomizer: Disabled mod extension:', extension.name);
            resolve();
          });
        });
      }
    }

    // Enable the randomly selected mod extension
    if (!selectedExtension.enabled) {
      await new Promise((resolve) => {
        chrome.management.setEnabled(selectedExtension.id, true, function() {
          console.log('Mod Randomizer: Enabled selected mod extension:', selectedExtension.name);
          resolve();
        });
      });
    }
  }
});
