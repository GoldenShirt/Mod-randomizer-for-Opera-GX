document.addEventListener('DOMContentLoaded', function () {
  // Get elements by ID
  const extensionList = document.getElementById('extensionList');
  const randomizeButton = document.getElementById('randomizeButton');
  const toggleAutoModIdentification = document.getElementById('toggleAutoModIdentification');
  const toggleRandomizeOnStartupChecked = document.getElementById('toggleRandomizeOnStartup');
  const modForm = document.getElementById('modForm');

  // Event listeners for checkbox state changes
  toggleAutoModIdentification.addEventListener('change', handleAutoModIdentificationChange);
  toggleRandomizeOnStartupChecked.addEventListener('change', handleRandomizeOnStartupChange);
  modForm.addEventListener('submit', handleFormSubmission);
  randomizeButton.addEventListener('click', handleRandomizeButtonClick);

  // Retrieve saved state of checkboxes on popup open
  chrome.storage.local.get(
  ['autoModIdentificationChecked', 'toggleRandomizeOnStartupChecked', 'randomizeOnStartup'],
  result => {
    toggleAutoModIdentification.checked = result.autoModIdentificationChecked || false;
    toggleRandomizeOnStartupChecked.checked = result.toggleRandomizeOnStartupChecked || false;

    if (toggleAutoModIdentification.checked) {
      identifyModExtensions();
    } else {
      simplifiedUpdateCheckboxes();
    }
  }
);


  // Function to update checkmarks without variables
  function simplifiedUpdateCheckboxes() {
    chrome.management.getAll(extensions => {
      chrome.storage.local.get('modExtensionIds', ({ modExtensionIds }) => {
        updateCheckboxes(extensions, modExtensionIds || []);
      });
    });
  }

  // Function to update checkboxes based on extension IDs
  function updateCheckboxes(extensions, modExtensionIds) {
    const extensionListContainer = document.getElementById('extensionList');
    // Clear the existing content
    extensionListContainer.innerHTML = '';

    // Sort extensions alphabetically by name
    extensions.sort((a, b) => a.name.localeCompare(b.name));

    extensions.forEach(extension => {
      if (extension.id !== 'toggleAutoModIdentification' && extension.id !== 'toggleRandomizeOnStartup') {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = extension.id;
        checkbox.checked = modExtensionIds.includes(extension.id);

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(extension.name));

        extensionListContainer.appendChild(label);
      }
    });
  }

  // Function to handle form submission
  function handleFormSubmission(event) {
    event.preventDefault();

    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    const modExtensionIds = Array.from(checkboxes)
      .filter(checkbox => checkbox.checked && checkbox.id !== 'toggleAutoModIdentification' && checkbox.id !== 'toggleRandomizeOnStartup')
      .map(checkbox => checkbox.id);

    // Save the mod extension IDs to local storage
    chrome.storage.local.set({ modExtensionIds }, () => {
      // Send a message to the background script
      console.log('Save button: modExtensionsSaved', modExtensionIds);
      window.close(); // Comment out this line when changing the code.
    });
  }

  // Function to handle "Randomize" button click
  function handleRandomizeButtonClick() {
    chrome.storage.local.get('modExtensionIds', ({ modExtensionIds }) => {
      if (modExtensionIds && modExtensionIds.length > 0) {
        disableAndEnableRandomExtension(modExtensionIds);
      } else {
        console.log('Error, mod extensions not found in local storage');
      }
    });
  }

  // Function to handle "Automatic Mod Identification" checkbox change
  function handleAutoModIdentificationChange() {
    chrome.storage.local.set({ autoModIdentificationChecked: toggleAutoModIdentification.checked });
	console.log('Automatic Mod Identification set to ' , toggleAutoModIdentification.checked);
    if (toggleAutoModIdentification.checked) {
      identifyModExtensions();
    } else {
      simplifiedUpdateCheckboxes();
    }
  }

  // Function to handle "Randomize on Startup" change and save the state
  function handleRandomizeOnStartupChange() {
    const randomizeOnStartup = toggleRandomizeOnStartupChecked.checked;
    chrome.storage.local.set({ toggleRandomizeOnStartupChecked: randomizeOnStartup, randomizeOnStartup });
    console.log('Randomize on startup is set to ', randomizeOnStartup);
  }

  // Function to automatically identify mod extensions and save them
  function identifyModExtensions() {
  chrome.management.getAll(extensions => {
    const modExtensionIds = extensions
      .filter(extension => extension.updateUrl === 'https://api.gx.me/store/mods/update')
      .map(extension => extension.id);

    // Filter for mod extensions based on stored IDs
    const modExtensions = extensions
      .filter(extension => modExtensionIds.includes(extension.id))
      .map(({ id, name, enabled }) => ({ id, name, enabled }));

    updateCheckboxes(extensions, modExtensionIds);

    chrome.storage.local.set({ modExtensionIds }, () => {
      console.log('Automatic Mod Identification: Mod Extensions identified:', {
        modExtensions,
      });
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

  const randomIndex = Math.floor(Math.random() * modExtensionIds.length);
  const randomExtensionId = modExtensionIds[randomIndex];

  setTimeout(() => {
    chrome.management.get(randomExtensionId, extension => {
      const { id, name, enabled } = extension;
      chrome.management.setEnabled(randomExtensionId, true, () => {
        console.log('Enabled Random Extension:', { id, name, enabled });

        // Display message to the user on the popup
        const messageElement = document.getElementById('message');
        messageElement.textContent = `Enabled Mod: ${name}`;

        // Create the hr element if not found
        let hrElement = document.querySelector('hr');
        if (!hrElement) {
          hrElement = document.createElement('hr');
          // Append it after the message element
          messageElement.insertAdjacentElement('afterend', hrElement);
        }

        // Create and show message "Redirecting to enable checkmarks..." with animation
        const redirectMessageElement = document.createElement('p');
        redirectMessageElement.textContent = 'Redirecting to enable checkmarks';
        redirectMessageElement.classList.add('redirect-message');
        // Insert it before the hr element
        hrElement.insertAdjacentElement('beforebegin', redirectMessageElement);

        // Show message "Redirecting to enable checkmarks..." with animation
        let dots = '';
        const interval = setInterval(() => {
          redirectMessageElement.textContent = `Redirecting to enable checkmarks${dots}`;
          dots += '.';
          if (dots.length > 3) {
            dots = '.';
          }
        }, 500); // Change the interval (milliseconds) as needed

        // Open the link opera://mods after 5 seconds
        setTimeout(() => {
          clearInterval(interval); // Stop the animation
          chrome.tabs.create({ url: 'opera://mods' });
        }, 5000);
      });
    });
  }, 100);
}






});
