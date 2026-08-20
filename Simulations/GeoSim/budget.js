// ============ GEOPOLITICS SIMULATOR — BUDGET PANEL ============

// Discretionary split each posture aims for when a category is on auto.
// Mandatory categories ignore this and track their own floor instead.
const POSTURES = {
    expansionist: { military: 24, infrastructure: 14, research: 8,  diplomacy: 3 },
    defensive:    { military: 20, infrastructure: 12, research: 12, diplomacy: 5 },
    economic:     { military: 10, infrastructure: 20, research: 15, diplomacy: 4 }
};

const budget = {
    categories: [],

    init() {
        this.categories = [...document.querySelectorAll('.budget-cat')].map(el => ({
            el,
            key: el.dataset.category,
            mandatory: el.dataset.type === 'mandatory',
            floor: parseInt(el.dataset.floor || '0', 10),
            slider: el.querySelector('.budget-slider'),
            label: el.querySelector('.pct-label'),
            auto: el.querySelector('.auto-chk input')
        }));

        for (const cat of this.categories) {
            this.placeFloorMark(cat);

            cat.slider.addEventListener('input', () => {
                if (cat.auto.checked) cat.auto.checked = false;
                this.syncCategory(cat);
                this.updateTotal();
            });

            cat.auto.addEventListener('change', () => {
                this.applyAuto(cat);
                this.updateTotal();
            });

            this.applyAuto(cat);
        }

        document.querySelectorAll('input[name="posture"]').forEach(radio => {
            radio.addEventListener('change', () => {
                for (const cat of this.categories) {
                    if (!cat.mandatory) this.applyAuto(cat);
                }
                this.updateTotal();
            });
        });

        this.updateTotal();
    },

    posture() {
        const picked = document.querySelector('input[name="posture"]:checked');
        return picked ? picked.value : 'defensive';
    },

    // The thumb centre travels inset by half its width at each end, so the
    // marker has to follow the same track rather than a raw percentage.
    placeFloorMark(cat) {
        const mark = cat.el.querySelector('.floor-mark');
        if (mark) mark.style.left = `calc(7px + (100% - 14px) * ${cat.floor / 100})`;
    },

    applyAuto(cat) {
        if (cat.auto.checked) {
            cat.slider.value = cat.mandatory
                ? cat.floor
                : POSTURES[this.posture()][cat.key];
        }
        cat.slider.disabled = cat.auto.checked;
        this.syncCategory(cat);
    },

    syncCategory(cat) {
        cat.label.textContent = cat.slider.value + '%';
        cat.el.classList.toggle(
            'deficit',
            cat.mandatory && parseInt(cat.slider.value, 10) < cat.floor
        );
    },

    updateTotal() {
        const total = this.categories
            .reduce((sum, cat) => sum + parseInt(cat.slider.value, 10), 0);
        const unallocated = 100 - total;
        const el = document.getElementById('unallocated');
        el.textContent = unallocated + '%';
        el.classList.toggle('over', unallocated < 0);
        el.classList.toggle('surplus', unallocated > 0);
    }
};
