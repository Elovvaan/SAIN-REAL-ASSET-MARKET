(() => {
  const nav = document.querySelector('.nav-list');
  if (nav && !nav.querySelector('[data-view="institution-participation"]')) {
    const homeProjects = nav.querySelector('[data-view="home-projects"]');
    const button = document.createElement('button');
    button.className = 'nav-item';
    button.dataset.view = 'institution-participation';
    button.innerHTML = '<span>▥</span> Institution Participation';
    if (homeProjects?.nextSibling) nav.insertBefore(button, homeProjects.nextSibling);
    else nav.appendChild(button);
  }

  if (!document.querySelector('link[href="/institution-workspace.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/institution-workspace.css';
    document.head.appendChild(link);
  }

  if (!document.querySelector('script[src="/institution-workspace.js"]')) {
    const script = document.createElement('script');
    script.src = '/institution-workspace.js';
    script.defer = true;
    document.body.appendChild(script);
  }
})();
