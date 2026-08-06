(() => {
  const load = (source, marker) => {
    if (document.querySelector(`script[${marker}]`)) return;
    const script = document.createElement('script');
    script.src = source;
    script.async = false;
    script.setAttribute(marker, 'true');
    document.head.append(script);
  };
  load('/workspace-shell-core.js', 'data-sra-workspace-shell-core');
  load('/participant-workspace-bootstrap.js', 'data-sra-participant-workspace-bootstrap');
})();
