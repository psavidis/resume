// DOM overlay: HUD counters, the toast for collected fruit, and the modal
// "page" that a smashed crate reveals. Kept out of the 3D layer entirely —
// the game loop just hands payloads over.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export class UI {
    constructor(root) {
        this.root = root;
        this.modal = root.querySelector('#modal');
        this.modalBody = root.querySelector('#modal-body');
        this.toastHost = root.querySelector('#toasts');
        this.crateCount = root.querySelector('#crate-count');
        this.fruitCount = root.querySelector('#fruit-count');
        this.zoneLabel = root.querySelector('#zone-label');
        this.songTitle = root.querySelector('#song-title');
        this.isOpen = false;
        this.onClose = null;

        root.querySelector('#modal-close').addEventListener('click', () => this.closeModal());
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.closeModal();
        });

        this.victory = root.querySelector('#victory');
        root.querySelector('#victory-island').addEventListener('click', () => {
            // Reloading is the simplest reliable way back to the start screen —
            // the world's broken-crate state would otherwise need a full reset.
            window.location.reload();
        });
    }

    showVictory() {
        if (this.isOpen) this.closeModal();
        this.victory.classList.add('open');
    }

    setCounts(crates, totalCrates, fruits, totalFruits) {
        this.crateCount.textContent = `${crates}/${totalCrates}`;
        this.fruitCount.textContent = `${fruits}/${totalFruits}`;
    }

    // Shows the current island's theme song name floating in the sky, timed
    // to roughly track the audio crossfade. `name` is the bare song title —
    // the leading track number from the mp3 filename is stripped by the
    // caller, never shown here. Pass null for an island with no theme song.
    setSongTitle(name) {
        if (this.songTitle.dataset.song === (name ?? '')) return;
        this.songTitle.dataset.song = name ?? '';

        if (!name) {
            this.songTitle.classList.remove('visible');
            return;
        }
        this.songTitle.textContent = `♪ ${name}`;
        this.songTitle.classList.add('visible');
    }

    setZone(name) {
        if (this.zoneLabel.dataset.zone === name) return;
        this.zoneLabel.dataset.zone = name;
        this.zoneLabel.textContent = name;
        this.zoneLabel.classList.remove('zone-pop');
        // Force a reflow so the animation restarts on every zone change.
        void this.zoneLabel.offsetWidth;
        this.zoneLabel.classList.add('zone-pop');
    }

    toast(text) {
        const el = document.createElement('div');
        el.className = 'toast';
        el.textContent = text;
        this.toastHost.appendChild(el);
        setTimeout(() => {
            el.classList.add('toast-out');
            setTimeout(() => el.remove(), 400);
        }, 1600);
    }

    openModal(html) {
        this.modalBody.innerHTML = html;
        this.modal.classList.add('open');
        this.isOpen = true;
    }

    closeModal() {
        this.modal.classList.remove('open');
        this.isOpen = false;
        if (this.onClose) this.onClose();
    }

    // ---- payload renderers -------------------------------------------------

    render(payload) {
        switch (payload.type) {
            case 'project': return this._project(payload.project);
            case 'role': return this._role(payload.exp);
            case 'education': return this._education(payload.edu);
            case 'contact': return this._contact(payload.data);
            default: return '<p>Nothing in here but sawdust.</p>';
        }
    }

    _project(p) {
        const links = p.links
            ? Object.entries(p.links).map(([label, url]) =>
                `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`).join('')
            : '';

        return `
      <span class="modal-kicker">Project unlocked</span>
      <h2>${esc(p.name)}</h2>
      <p class="modal-meta">${esc(p.company)} · ${esc(p.startDate)} → ${esc(p.endDate)}</p>
      ${p.badges ? `<div class="badges">${p.badges.map((b) => `<span class="badge">${esc(b)}</span>`).join('')}</div>` : ''}
      <p class="modal-desc">${esc(p.description)}</p>
      ${p.points && p.points.length ? `
        <h3>What I did</h3>
        <ul>${p.points.map((pt) => `<li>${esc(pt.replace(/^- /, ''))}</li>`).join('')}</ul>` : ''}
      ${p.techUsed && p.techUsed.length ? `
        <h3>Tech used</h3>
        <div class="tech">${p.techUsed.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
      ${links ? `<div class="links">${links}</div>` : ''}
    `;
    }

    _role(exp) {
        return `
      <span class="modal-kicker">Role unlocked</span>
      <h2>${esc(exp.title)}</h2>
      <p class="modal-meta">
        <a href="${esc(exp.companyLink)}" target="_blank" rel="noopener">${esc(exp.company)} ↗</a>
      </p>
      <ul class="facts">
        <li><strong>When</strong><span>${esc(exp.startDate)} → ${esc(exp.endDate)}</span></li>
        <li><strong>Where</strong><span>${esc(exp.location)}</span></li>
        <li><strong>Type</strong><span>${esc(exp.employmentType)}</span></li>
        <li><strong>Mode</strong><span>${esc(exp.workMode)}</span></li>
      </ul>
    `;
    }

    _education(edu) {
        return `
      <span class="modal-kicker">Education unlocked</span>
      <h2>${esc(edu.degree)}</h2>
      <p class="modal-meta">${esc(edu.fieldOfStudy)}</p>
      <ul class="facts">
        <li><strong>School</strong><span>
          <a href="${esc(edu.schoolLink)}" target="_blank" rel="noopener">${esc(edu.school)} ↗</a>
        </span></li>
        <li><strong>Years</strong><span>${esc(edu.startYear)}–${esc(edu.endYear)}</span></li>
      </ul>
    `;
    }

    _contact(data) {
        return `
      <span class="modal-kicker">Bonus crate</span>
      <h2>${esc(data.name)}</h2>
      <p class="modal-desc">${esc(data.summary)}</p>
      <ul class="facts">
        <li><strong>Location</strong><span>${esc(data.addressLocation)}</span></li>
        <li><strong>Email</strong><span>
          <a href="mailto:${esc(data.email)}">${esc(data.email)}</a>
        </span></li>
        <li><strong>LinkedIn</strong><span>
          <a href="https://${esc(data.linkedInURL)}" target="_blank" rel="noopener">${esc(data.linkedInURL)} ↗</a>
        </span></li>
        <li><strong>Languages</strong><span>${esc(data.languages.join(', '))}</span></li>
      </ul>
      <div class="links"><a href="index.html">📄 Read the classic resume</a></div>
    `;
    }
}
