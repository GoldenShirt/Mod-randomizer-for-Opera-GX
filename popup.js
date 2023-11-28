document.addEventListener('DOMContentLoaded', function() {
  var extensionList = document.getElementById('extensionList');
  var randomizeButton = document.getElementById('randomizeButton');

  chrome.management.getAll(function(extensions) {
    chrome.storage.local.get('modExtensionIds', function(result) {
      var modExtensionIds = result.modExtensionIds || [];

      extensions.forEach(function(extension) {
        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = extension.id;
        checkbox.checked = modExtensionIds.includes(extension.id);

        var label = document.createElement('label');
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(extension.name));

        extensionList.appendChild(label);
      });
    });
  });

  var modForm = document.getElementById('modForm');
  modForm.addEventListener('submit', function(event) {
    event.preventDefault();

    var checkboxes = document.querySelectorAll('input[type="checkbox"]');
    var modExtensionIds = Array.from(checkboxes)
      .filter(function(checkbox) {
        return checkbox.checked;
      })
      .map(function(checkbox) {
        return checkbox.id;
      });

    // Save the mod extension IDs to local storage
    chrome.storage.local.set({ modExtensionIds: modExtensionIds }, function() {
      console.log('Mod extensions saved:', modExtensionIds);
      window.close();
    });
  });

  randomizeButton.addEventListener('click', function() {
    var checkboxes = document.querySelectorAll('input[type="checkbox"]');
    var checkedModExtensions = Array.from(checkboxes).filter(function(checkbox) {
      return checkbox.checked;
    });

    if (checkedModExtensions.length > 0) {
      // Disable all MOD extensions
      checkedModExtensions.forEach(function(extension) {
        chrome.management.setEnabled(extension.id, false);
      });

      // Choose a random MOD extension and enable it
      var randomIndex = Math.floor(Math.random() * checkedModExtensions.length);
      var randomExtension = checkedModExtensions[randomIndex];
      setTimeout(function() {
        chrome.management.setEnabled(randomExtension.id, true);
      }, 100);
    }
  });
});