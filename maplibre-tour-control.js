/**
 * MapLibre Tour Control
 * A  plugin to fly through a GeoJSON manifest of locations.
 */
export class MapLibreTourControl {

    constructor(options) {
        this.options = Object.assign({
            manifest: null,         // URL to the JSON file
            contentBaseUrl: 'content/', // Folder prefix for HTML snippets
            popupOptions: {         // Standard MapLibre Popup options
                closeButton: false,
                closeOnClick: true,
                maxWidth: '350px',
                offset: 25,
                className: 'glass-popup' // Default to our glass theme
            }
        }, options);

        this.map = null;
        this.container = null;
        this.tourFeatures = [];
        this.currentIndex = -1;
        this.popup = null;
        this.layerStateSnapshot = {};
    }

    /**
     * IControl Interface: onAdd
     * MapLibre calls this when the control is added to the map.
     */
    onAdd(map) {
        this.map = map;

        // 1. Create the Container
        this.container = document.createElement('div');
        this.container.className = 'maplibregl-ctrl maplibregl-ctrl-tour';

        // 2. Build Internal HTML (Title Dropdown + Buttons)
        // We use embedded SVGs for the arrows so no external assets are needed.
        const leftArrow = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>`;
        const rightArrow = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>`;

        this.container.innerHTML = `
            <div class="tour-header-row">
                <div class="tour-info">
                    <select class="tour-title-select" title="Jump to stop">
                        <option value="-1">Loading Tour...</option>
                    </select>
                </div>
            </div>
            <div class="tour-buttons">
                <button type="button" class="btn-prev" disabled>${leftArrow} Prev</button>
                <button type="button" class="btn-next">${rightArrow} Next</button>
            </div>
        `;

        // 3. Cache References
        this.dropdownEl = this.container.querySelector('.tour-title-select');
        this.btnPrev = this.container.querySelector('.btn-prev');
        this.btnNext = this.container.querySelector('.btn-next');

        // 4. Attach Events
        this.btnPrev.addEventListener('click', () => this.prev());
        this.btnNext.addEventListener('click', () => this.next());
        this.dropdownEl.addEventListener('change', (e) => {
            const index = parseInt(e.target.value, 10);
            this.goToStop(index);
        });

        // 5. Initialize Popup
        this.popup = new maplibregl.Popup(this.options.popupOptions);

        // 6. Fetch Data
        if (this.options.manifest) {
            this.fetchManifest(this.options.manifest);
        } else {
            console.warn("MapLibreTourControl: No 'manifest' option provided.");
        }

        return this.container;
    }

    onRemove() {
        this.restoreLayerState();
        this.container.parentNode.removeChild(this.container);
        this.map = null;
        if (this.popup) this.popup.remove();
    }

    async fetchManifest(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();

            // Support both raw array and FeatureCollection
            this.tourFeatures = data.features || data;

            this.buildDropdown();
            this.updateUIState();
        } catch (err) {
            console.error("Tour Load Failed:", err);
            this.dropdownEl.innerHTML = '<option>Error loading tour</option>';
        }
    }

    buildDropdown() {
        this.dropdownEl.innerHTML = '';

        // Placeholder
        const startOpt = document.createElement('option');
        startOpt.value = -1;
        startOpt.textContent = "Start Tour";
        this.dropdownEl.appendChild(startOpt);

        // Items
        this.tourFeatures.forEach((feature, index) => {
            const opt = document.createElement('option');
            opt.value = index;
            // Handle both GeoJSON properties or flat JSON
            const title = feature.properties ? feature.properties.title : feature.title;
            opt.textContent = title || `Stop ${index + 1}`;
            this.dropdownEl.appendChild(opt);
        });
    }

    next() {
        let nextIndex = this.currentIndex + 1;
        if (nextIndex >= this.tourFeatures.length) nextIndex = 0; // Loop
        this.goToStop(nextIndex);
    }

    prev() {
        if (this.currentIndex > 0) {
            this.goToStop(this.currentIndex - 1);
        }
    }

    goToStop(index) {
        if (index < 0 || index >= this.tourFeatures.length) return;

        // 1. RESTORE: Undo whatever the previous slide did
        this.restoreLayerState();

        this.currentIndex = index;
        const feature = this.tourFeatures[index];
        const props = feature.properties || feature;

        // 2. APPLY: Check if this new slide has special effects
        this.applyLayerEffects(props);


        const coords = feature.geometry ? feature.geometry.coordinates : feature.location;

        // Camera
        this.map.flyTo({
            center: coords,
            zoom: props.zoom || 10,
            pitch: props.pitch || 0,
            bearing: props.bearing || 0,
            speed: 0.8,
            curve: 1.2,
            essential: true
        });

        // Popup
        this.popup.remove();
        const file = props.content_file;

        if (file) {
            const fullUrl = this.options.contentBaseUrl + file;
            fetch(fullUrl)
                .then(res => res.text())
                .then(html => {
                    this.popup.setLngLat(coords).setHTML(html).addTo(this.map);
                })
                .catch(() => {
                    this.popup.setLngLat(coords).setHTML(`<h3>${props.title}</h3>`).addTo(this.map);
                });
        } else {
            this.popup.setLngLat(coords).setHTML(`<h3>${props.title}</h3>`).addTo(this.map);
        }

        this.updateUIState();
    }

    updateUIState() {
        this.dropdownEl.value = this.currentIndex;

        if (this.currentIndex === -1) {
            this.btnPrev.disabled = true;
            this.btnNext.innerHTML = `Start <span style="font-size:1.2em">›</span>`;
        } else {
            this.btnPrev.disabled = (this.currentIndex === 0);

            if (this.currentIndex === this.tourFeatures.length - 1) {
                this.btnNext.innerHTML = `Restart ↻`;
            } else {
                // We re-insert the SVG icon here because innerHTML wiped it
                const rightArrow = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>`;
                this.btnNext.innerHTML = `${rightArrow} Next`;
            }
        }
    }

    /**
     * Reverts any layer changes made by the previous slide.
     */
    restoreLayerState() {
        // Iterate over the saved snapshot
        for (const [layerId, originalVisibility] of Object.entries(this.layerStateSnapshot)) {
            if (this.map.getLayer(layerId)) {
                this.map.setLayoutProperty(layerId, 'visibility', originalVisibility);
            }
        }
        // Clear the snapshot
        this.layerStateSnapshot = {};
    }

    /**
     * Applies new layer visibility and saves the old state.
     */
    applyLayerEffects(props) {
        const effects = props.effects;
        if (!effects) return;

        const handleLayer = (layerId, targetState) => {
            if (!this.map.getLayer(layerId)) {
                console.warn(`Tour Effect: Layer '${layerId}' not found.`);
                return;
            }

            // 1. Get current state (default to 'visible' if undefined)
            const currentState = this.map.getLayoutProperty(layerId, 'visibility') || 'visible';

            // 2. Save it to snapshot IF we haven't already saved it this step
            // (This check prevents overwriting if we toggle the same layer twice)
            if (!(layerId in this.layerStateSnapshot)) {
                this.layerStateSnapshot[layerId] = currentState;
            }

            // 3. Apply new state
            this.map.setLayoutProperty(layerId, 'visibility', targetState);
        };

        // Process Hides
        if (effects.hide) {
            effects.hide.forEach(id => handleLayer(id, 'none'));
        }

        // Process Shows
        if (effects.show) {
            effects.show.forEach(id => handleLayer(id, 'visible'));
        }
    }
}