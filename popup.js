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
    toggleAutoModIdentification.addEventListener('change', () => handleCheckboxChange('autoModIdentificationChecked', toggleAutoModIdentification.checked));
    toggleRandomizeOnStartup.addEventListener('change', () => handleCheckboxChange('toggleRandomizeOnStartupChecked', toggleRandomizeOnStartup.checked));
    modForm.addEventListener('submit', handleFormSubmission);
    randomizeButton.addEventListener('click', () => handleRandomizeButtonClick());
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

  function handleCheckboxChange(key, value) {
  chrome.storage.local.set({ [key]: value }, () => {
    console.log(`${key} set to ${value}`);
    if (key === 'autoModIdentificationChecked') {
      if (value) {
        sendMessageToBackground('identifyModExtensions');
      }
      // Update all checkboxes immediately
      const checkboxes = document.querySelectorAll('#extensionList input[type="checkbox"]');
      checkboxes.forEach(checkbox => {
        checkbox.disabled = value;
      });
    }
  });
}


function handleRandomizeButtonClick() {
    sendMessageToBackground('randomizeMods');
	 if (randomizeTimeout) {
      clearTimeout(randomizeTimeout);
    }
    if (redirectTimeout) {
      clearTimeout(redirectTimeout);
    }
    removeRedirectMessage();
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

    sendMessageToBackground('saveModExtensionIds', { modExtensionIds });
	 window.close();
  }
  

  function updateCheckboxes() {
    chrome.runtime.sendMessage({ action: 'getExtensions' }, ({ extensions, modExtensionIds, autoModIdentificationChecked }) => {
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

 function sendMessageToBackground(action, data = {}) {
  chrome.runtime.sendMessage({ action, ...data }, (response) => {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError);
    } else {
      console.log(`Background response: ${response.status}`);
      if (response.status === 'success' && action === 'randomizeMods') {
        const enabledExtension = response.enabledExtension;
        const modExtensionIds = response.modExtensionIds || []; // Handle potential undefined

        if (enabledExtension) {
          showEnabledMessage(enabledExtension); // Update the UI with the enabled extension
        } else {
          console.error('No extension was enabled.');
        }
      } else if (response.status === 'error') {
        console.error(response.message);
      }
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
