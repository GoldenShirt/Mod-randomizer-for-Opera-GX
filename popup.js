// popup.js (rewritten)
// - Uses existing HTML IDs only
// - Profiles via profileSelect + New/Delete buttons (rename by double-click on select)
// - Keeps profilesOrder in storage so items remain visible & ordered even if unchecked
// - Shows only detected mods + profile-known mods
// - Disables manual list visually when auto-identify is ON
// - Proper time conversion and display (no misleading "0")
// - Logs actions to console for debugging

document.addEventListener('DOMContentLoaded', () => {
    // --- Elements (must match popup.html) ---
    const els = {
        profileSelect: document.getElementById('profileSelect'),
        newProfileBtn: document.getElementById('newProfileBtn'),
        deleteProfileBtn: document.getElementById('deleteProfileBtn'),

        autoModToggle: document.getElementById('toggleAutoModIdentification'),
        openModsToggle: document.getElementById('toggleOpenModsTab'),
        startupToggle: document.getElementById('toggleRandomizeOnStartup'),
        setTimeToggle: document.getElementById('toggleRandomizeOnSetTime'),

        timeInput: document.getElementById('timeInput'),
        timeUnit: document.getElementById('timeUnitSelect'),

        randomizeButton: document.getElementById('randomizeButton'),

        extensionList: document.getElementById('extensionList'),
        searchBar: document.getElementById('searchBar'),

        currentMod: document.getElementById('current-mod'),
        message: document.getElementById('message'),
    };

    // --- Helpers for chrome APIs ---
    const storageGet = (keys) => new Promise(resolve => chrome.storage.local.get(keys, resolve));
    const storageSet = (obj) => new Promise(resolve => chrome.storage.local.set(obj, resolve));
    const sendMsg = (action, data = {}) =>
        new Promise(resolve => chrome.runtime.sendMessage({ action, ...data }, (res) => {
            if (chrome.runtime.lastError) {
                console.warn('sendMsg lastError:', chrome.runtime.lastError.message);
            }
            resolve(res);
        }));

    // --- Formatting helpers for time units ---
    function toMinutes(value, unit) {
        const v = parseFloat(value);
        if (isNaN(v)) return NaN;
        if (unit === 'minutes') return v;
        if (unit === 'hours') return v * 60;
        if (unit === 'days') return v * 24 * 60;
        return v;
    }
    function fromMinutesFormat(minutes, unit) {
        if (minutes === undefined || minutes === null) return '';
        const m = Number(minutes);
        if (isNaN(m)) return '';

        let v;
        if (unit === 'minutes') v = m;
        else if (unit === 'hours') v = m / 60;
        else if (unit === 'days') v = m / (24 * 60);
        else v = m;

        // Decide decimals: >=1 -> 2 decimals max (trim); <1 -> up to 4 decimals
        if (Math.abs(v) >= 1) {
            return trimZeros(v.toFixed(2));
        } else {
            return trimZeros(v.toFixed(4));
        }
    }
    function trimZeros(s) {
        // remove trailing zeros and possible trailing dot
        return s.replace(/\.?0+$/, '');
    }

    // --- Profile order storage helpers ---
    // profilesOrder: { profileName: [id1,id2,...] } stored in chrome.storage.local
    async function ensureProfilesOrder(profiles) {
        const st = await storageGet('profilesOrder');
        let profilesOrder = st.profilesOrder || {};
        let changed = false;
        for (const profileName of Object.keys(profiles)) {
            if (!profilesOrder[profileName]) {
                profilesOrder[profileName] = Array.isArray(profiles[profileName]) ? [...profiles[profileName]] : [];
                changed = true;
            } else {
                // ensure any enabled ids are present in order
                const enabled = Array.isArray(profiles[profileName]) ? profiles[profileName] : [];
                for (const id of enabled) {
                    if (!profilesOrder[profileName].includes(id)) {
                        profilesOrder[profileName].push(id);
                        changed = true;
                    }
                }
            }
        }
        if (changed) {
            await storageSet({ profilesOrder });
            console.log('Initialized/updated profilesOrder');
        }
        return profilesOrder;
    }

    // --- UI updates: profiles ---
    async function loadAndRenderProfiles() {
        const resp = await sendMsg('getExtensions');
        const profiles = resp?.profiles || (await storageGet('profiles')).profiles || { Default: [] };
        const activeProfile = resp?.activeProfile || (await storageGet('activeProfile')).activeProfile || Object.keys(profiles)[0] || 'Default';

        // populate select
        els.profileSelect.innerHTML = '';
        for (const name of Object.keys(profiles)) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            if (name === activeProfile) opt.selected = true;
            els.profileSelect.appendChild(opt);
        }

        // Make sure profilesOrder exists and includes these profiles
        await ensureProfilesOrder(profiles);

        // Wire rename by double-click on select
        // (limit: double-click anywhere on select triggers rename of currently selected profile)
        // remove previous dblclick listener if any: can't remove anonymous - ensure we add only once by flag
        if (!els.profileSelect._hasDbl) {
            els.profileSelect.addEventListener('dblclick', async () => {
                const oldName = els.profileSelect.value;
                const newName = prompt('Rename profile', oldName);
                if (!newName || newName === oldName) return;
                const res = await sendMsg('renameProfile', { oldName, newName });
                if (res && res.status === 'success') {
                    // If we store profilesOrder locally, rename that too
                    const st = await storageGet('profilesOrder');
                    const po = st.profilesOrder || {};
                    if (po[oldName]) {
                        po[newName] = po[oldName];
                        delete po[oldName];
                        await storageSet({ profilesOrder: po });
                    }
                    console.log(`Renamed profile ${oldName} -> ${newName}`);
                    await loadAndRenderProfiles();
                    // set active profile in background was done by renameProfile handler
                } else {
                    alert(res && res.message ? res.message : 'Rename failed');
                }
            });
            els.profileSelect._hasDbl = true;
        }
    }

    els.profileSelect.addEventListener('change', async (e) => {
        const profileName = e.target.value;
        await sendMsg('setActiveProfile', { profileName });
        console.log('Profile switched to', profileName);
        await renderExtensionList();
    });

    els.newProfileBtn.addEventListener('click', async () => {
        const name = prompt('New profile name:');
        if (!name) return;
        const r = await sendMsg('createProfile', { profileName: name });
        if (r && r.status === 'success') {
            // ensure profilesOrder entry
            const st = await storageGet('profilesOrder');
            const po = st.profilesOrder || {};
            if (!po[name]) { po[name] = []; await storageSet({ profilesOrder: po }); }
            console.log('Created profile', name);
            await loadAndRenderProfiles();
            // make it active
            await sendMsg('setActiveProfile', { profileName: name });
            await renderExtensionList();
        } else {
            alert(r && r.message ? r.message : 'Failed to create profile');
        }
    });

    els.deleteProfileBtn.addEventListener('click', async () => {
        const profileName = els.profileSelect.value;
        if (!confirm(`Delete profile "${profileName}"? This cannot be undone.`)) return;
        const r = await sendMsg('deleteProfile', { profileName });
        if (r && r.status === 'success') {
            // remove from profilesOrder too
            const st = await storageGet('profilesOrder');
            const po = st.profilesOrder || {};
            if (po[profileName]) { delete po[profileName]; await storageSet({ profilesOrder: po }); }
            console.log('Deleted profile', profileName);
            await loadAndRenderProfiles();
            await renderExtensionList();
        } else {
            alert(r && r.message ? r.message : 'Delete failed');
        }
    });

    // --- Extension / manual list rendering ---
    // We render items in the order defined in profilesOrder[active], then any enabled-but-not-in-order, then detected extras.
    async function renderExtensionList() {
        // fetch everything
        const resp = await sendMsg('getExtensions');
        const settings = await storageGet('autoModIdentificationChecked');
        const autoModIdentificationChecked = settings.autoModIdentificationChecked;
        if (autoModIdentificationChecked) {
            els.extensionList.parentElement.classList.add("disabled"); // fieldset.manual-section
        } else {
            els.extensionList.parentElement.classList.remove("disabled");
        }
        // background may return different shapes; handle both
        const detected = resp?.detectedModList
            || (resp?.extensions ? resp.extensions.filter(e => e.updateUrl === 'https://api.gx.me/store/mods/update').map(e => ({ id: e.id, name: e.name })) : []);
        const profiles = resp?.profiles || (await storageGet('profiles')).profiles || { Default: [] };
        const active = resp?.activeProfile || (await storageGet('activeProfile')).activeProfile || Object.keys(profiles)[0] || 'Default';
        const autoIdentify = resp?.autoModIdentificationChecked;
        const profileList = Array.isArray(profiles[active]) ? profiles[active] : [];

        const detectedMap = new Map((detected || []).map(d => [d.id, d.name]));

        // profilesOrder from storage
        const st = await storageGet('profilesOrder');
        let profilesOrder = st.profilesOrder || {};
        if (!profilesOrder[active]) {
            profilesOrder[active] = [...profileList];
            await storageSet({ profilesOrder });
        }

        // Build display order (preserve order array)
        const order = profilesOrder[active].slice(); // copy
        const seen = new Set(order);
        // ensure enabled (profileList) items are present in order (without changing order of existing items)
        for (const id of profileList) if (!seen.has(id)) { order.push(id); seen.add(id); }
        // add detected mods not seen
        for (const d of detected) if (!seen.has(d.id)) { order.push(d.id); seen.add(d.id); }

        // Render list (but do not remove items from order on uncheck)
        els.extensionList.innerHTML = '';
        els.extensionList.classList.toggle('disabled', !!autoIdentify);

        for (const id of order) {
            const name = detectedMap.get(id) || 'Unknown Mod (not detected)';
            const li = document.createElement('li');
            li.dataset.extid = id;

            // label
            const label = document.createElement('span');
            label.textContent = name;
            label.title = name;
            label.style.flex = '1';

            // checkbox
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.dataset.extid = id;
            cb.checked = profileList.includes(id); // true if currently enabled in profile (saved)
            cb.disabled = !!autoIdentify;
            cb.addEventListener('change', onManualCheckboxChange);

            li.appendChild(cb);
            li.appendChild(label);
            els.extensionList.appendChild(li);
        }

        console.log('Rendered manual list for profile', active, 'entries', order.length);
    }

    // When a checkbox changes: save checked ids to active profile but KEEP order in profilesOrder (don't remove unchecked)
    let manualSaveDebounce = null;
    async function onManualCheckboxChange() {
        // debounce quick toggles
        if (manualSaveDebounce) clearTimeout(manualSaveDebounce);
        manualSaveDebounce = setTimeout(async () => {
            const checkedIds = Array.from(els.extensionList.querySelectorAll('input[type="checkbox"]'))
                .filter(cb => cb.checked)
                .map(cb => cb.dataset.extid);

            const resp = await sendMsg('getExtensions');
            const active = resp?.activeProfile || (await storageGet('activeProfile')).activeProfile || 'Default';

            // Update profilesOrder to include any newly checked ids if missing (append at end), but DO NOT remove unchecked ids.
            const st = await storageGet('profilesOrder');
            const profilesOrder = st.profilesOrder || {};
            profilesOrder[active] = profilesOrder[active] || [];

            let changed = false;
            for (const id of checkedIds) {
                if (!profilesOrder[active].includes(id)) { profilesOrder[active].push(id); changed = true; }
            }
            if (changed) {
                await storageSet({ profilesOrder });
                console.log('Updated profilesOrder after manual save');
            }

            // Save the currently checked ids as the profile's enabled list (background will store to profiles[active])
            const saveRes = await sendMsg('saveModExtensionIds', { modExtensionIds: checkedIds, profileName: active });
            console.log(`Saved ${checkedIds.length} mods to profile "${active}"`, saveRes);
        }, 250);
    }

    // --- Search filter ---
    function onSearchInput() {
        const q = els.searchBar.value.trim().toLowerCase();
        for (const li of Array.from(els.extensionList.children)) {
            const text = li.textContent.toLowerCase();
            li.style.display = text.includes(q) ? '' : 'none';
        }
    }

    // --- Randomize action ---
    async function onRandomizeClick() {
        console.log('Randomize clicked');
        showRedirectPlaceholder();
        const r = await sendMsg('randomizeMods');
        if (r?.status === 'success') {
            if (r.enabledExtension) {
                showEnabledMessage(r.enabledExtension);
                await refreshCurrentMod();
            }
            console.log('Manual randomize request sent; background processing.');
        } else {
            console.error('Randomize failed', r);
            showError('Randomize failed: ' + (r?.message || 'unknown'));
        }
    }

    // --- Redirect placeholder & messages ---
    function removeRedirectMessage() {
        document.querySelectorAll('.redirect-message').forEach(el => {
            if (el.dataset.intervalId) clearInterval(parseInt(el.dataset.intervalId));
            el.remove();
        });
        const hr = document.getElementById('message-hr');
        const enabled = document.getElementById('enabledMessage');
        if (hr && !enabled) hr.remove(); // leave hr if enabled message inserted below
    }

    function showRedirectPlaceholder() {
        removeRedirectMessage();
        // Insert a small animated text under message-hr or button
        const placeholder = document.createElement('p');
        placeholder.className = 'redirect-message';
        placeholder.textContent = 'Redirecting to enable checkmarks';
        let dots = '';
        const interval = setInterval(() => {
            dots = dots.length < 3 ? dots + '.' : '';
            placeholder.textContent = 'Redirecting to enable checkmarks' + dots;
        }, 300);
        placeholder.dataset.intervalId = interval;
        const hr = document.getElementById('message-hr');
        if (hr) hr.insertAdjacentElement('afterend', placeholder);
        else els.randomizeButton.insertAdjacentElement('afterend', placeholder);
    }

    function showEnabledMessage(extension) {
        removeRedirectMessage();
        // ensure hr exists
        let hr = document.getElementById('message-hr');
        if (!hr) {
            hr = document.createElement('hr');
            hr.id = 'message-hr';
            els.randomizeButton.insertAdjacentElement('afterend', hr);
        }
        // remove previous
        document.getElementById('enabledMessage')?.remove();
        const d = document.createElement('div');
        d.id = 'enabledMessage';
        d.innerHTML = `Enabled Mod: <span class="mod-name">${escapeHtml(extension.name)}</span>`;
        hr.insertAdjacentElement('afterend', d);
    }

    function showError(text) {
        els.message.textContent = text;
        setTimeout(() => { if (els.message.textContent === text) els.message.textContent = ''; }, 4000);
    }

    function escapeHtml(s) {
        return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    // --- Time input handling ---
    let timeDebounce = null;
    async function onTimeInputChange() {
        if (timeDebounce) clearTimeout(timeDebounce);
        timeDebounce = setTimeout(async () => {
            const raw = els.timeInput.value;
            const unit = els.timeUnit.value;
            if (!raw && raw !== '0') {
                // treat empty as disabled
                await sendMsg('setRandomizeTime', { time: 0 });
                console.log('Time disabled (empty)');
                return;
            }
            const parsed = parseFloat(raw);
            if (isNaN(parsed)) {
                alert('Invalid time value');
                return;
            }
            // allow 0.25 only for minutes
            if (unit === 'minutes' && parsed === 0.25) {
                await sendMsg('setRandomizeTime', { time: 0.25 });
                console.log('Time set -> 0.25 minutes (test)');
                return;
            }
            // validation
            if (unit === 'minutes' && parsed < 1) {
                alert('Randomize time must be at least 1 minute (or 0.25 for testing) or 0 to disable.');
                return;
            }
            if ((unit === 'hours' || unit === 'days') && parsed < 1) {
                alert(`Randomize time must be at least 1 ${unit} or 0 to disable.`);
                return;
            }
            const minutes = toMinutes(parsed, unit);
            if (isNaN(minutes)) return;
            await sendMsg('setRandomizeTime', { time: minutes });
            console.log('Time set ->', minutes, 'minutes (from', parsed, unit, ')');
        }, 400);
    }

    async function onTimeUnitChange() {
        const oldUnit = els.timeUnit.dataset.previousUnit || 'minutes';
        const newUnit = els.timeUnit.value;
        els.timeUnit.dataset.previousUnit = newUnit;
        await storageSet({ timeUnit: newUnit });

        // convert stored minutes value to display
        const s = await storageGet('randomizeTime');
        const minutes = s.randomizeTime;
        if (minutes || minutes === 0) {
            els.timeInput.value = fromMinutesFormat(minutes, newUnit);
        } else {
            els.timeInput.value = '';
        }
        console.log('Time unit changed ->', newUnit);
    }

    // --- Read & display currentMod & consume pendingRandomization ---
    async function refreshCurrentMod() {
        const s = await storageGet('currentMod');
        const name = s.currentMod || 'None';
        els.currentMod.textContent = `Current Mod: ${name}`;
    }

    async function consumePendingRandomization() {
        const s = await storageGet('pendingRandomization');
        const pending = s.pendingRandomization;
        if (pending && pending.enabledExtension) {
            const age = Date.now() - (pending.timestamp || 0);
            if (age < 30 * 1000) {
                showEnabledMessage(pending.enabledExtension);
                console.log('Consumed pendingRandomization:', pending);
            }
            // clear it so it doesn't repeat
            await storageSet({ pendingRandomization: null });
        }
    }

    // --- Toggles handlers ---
    async function onToggleChange(key, inputEl) {
        await storageSet({ [key]: inputEl.checked });
        console.log(`Toggle changed: ${key} = ${inputEl.checked}`);

        if (key === 'autoModIdentificationChecked') {
            if (inputEl.checked) {
                // ask background to identify and then re-render
                await sendMsg('identifyModExtensions');
                console.log('Requested identifyModExtensions due to toggle on');
            }
            // always re-render list (to enable/disable checkboxes + overlay)
            await renderExtensionList();
        }
        if (key === 'toggleRandomizeOnSetTimeChecked') {
            await sendMsg('toggleRandomizeOnSetTimeChecked', { value: inputEl.checked });
            console.log('Requested toggleRandomizeOnSetTimeChecked', inputEl.checked);
        }
    }

    // --- Event wiring ---
    els.searchBar.addEventListener('input', onSearchInput);

    els.randomizeButton.addEventListener('click', onRandomizeClick);

    els.autoModToggle.addEventListener('change', () => onToggleChange('autoModIdentificationChecked', els.autoModToggle));
    els.openModsToggle.addEventListener('change', () => onToggleChange('toggleOpenModsTabChecked', els.openModsToggle));
    els.startupToggle.addEventListener('change', () => onToggleChange('toggleRandomizeOnStartupChecked', els.startupToggle));
    els.setTimeToggle.addEventListener('change', () => onToggleChange('toggleRandomizeOnSetTimeChecked', els.setTimeToggle));

    els.timeInput.addEventListener('input', onTimeInputChange);
    els.timeInput.addEventListener('change', onTimeInputChange);
    els.timeUnit.addEventListener('change', onTimeUnitChange);

    // Listen for background runtime notifications while popup is open
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg?.action === 'randomizationCompleted' && msg.enabledExtension) {
            showEnabledMessage(msg.enabledExtension);
            refreshCurrentMod();
            console.log('Popup received randomizationCompleted runtime message');
        }
    });

    // React to storage changes to stay up to date
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.currentMod) refreshCurrentMod();
        if (changes.detectedModList || changes.profiles || changes.profilesOrder || changes.autoModIdentificationChecked) {
            // re-render everything
            (async () => {
                await loadAndRenderProfiles();
                await renderExtensionList();
            })();
        }
    });

    // --- Initialization on popup open ---
    (async function init() {
        // Prevent default submit behavior
        document.getElementById('modForm')?.addEventListener('submit', e => e.preventDefault());

        // Ask background we opened (it may identify mods)
        await sendMsg('popupOpened');

        // load toggles & time unit & time value
        const s = await storageGet([
            'autoModIdentificationChecked',
            'toggleOpenModsTabChecked',
            'toggleRandomizeOnStartupChecked',
            'toggleRandomizeOnSetTimeChecked',
            'randomizeTime',
            'timeUnit',
            'currentMod'
        ]);

        els.autoModToggle.checked = !!s.autoModIdentificationChecked;
        els.openModsToggle.checked = s.toggleOpenModsTabChecked === undefined ? true : !!s.toggleOpenModsTabChecked;
        els.startupToggle.checked = !!s.toggleRandomizeOnStartupChecked;
        els.setTimeToggle.checked = !!s.toggleRandomizeOnSetTimeChecked;

        const unit = s.timeUnit || 'minutes';
        els.timeUnit.value = unit;
        els.timeUnit.dataset.previousUnit = unit;
        els.timeInput.value = (s.randomizeTime || s.randomizeTime === 0) ? fromMinutesFormat(s.randomizeTime, unit) : '';

        await loadAndRenderProfiles();
        await renderExtensionList();
        await refreshCurrentMod();
        await consumePendingRandomization();

        console.log('Popup initialized');
    })();
});
