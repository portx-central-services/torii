/* Main App + router */

const D = window.PORTX_DATA;

const DEFAULT_TWEAKS = /*EDITMODE-BEGIN*/{
  "density": "comfortable",
  "accentTreatment": "branded"
}/*EDITMODE-END*/;

function App() {
  const [route, setRoute] = React.useState(() => {
    // Read from URL hash for shareable deep-links
    const hash = window.location.hash.slice(1);
    if (hash.startsWith('project/')) return { view: 'project-detail', projectId: hash.slice('project/'.length) };
    if (hash === 'capacity') return { view: 'capacity' };
    return { view: 'projects' };
  });

  // Persist route in URL
  React.useEffect(() => {
    let hash = '';
    if (route.view === 'project-detail') hash = 'project/' + route.projectId;
    else if (route.view !== 'projects') hash = route.view;
    window.history.replaceState(null, '', hash ? '#' + hash : window.location.pathname);
  }, [route]);

  const [tweaks, setTweak] = window.useTweaks(DEFAULT_TWEAKS);

  // Apply tweaks via root attribute → CSS hooks
  React.useEffect(() => {
    document.documentElement.dataset.density = tweaks.density;
    document.documentElement.dataset.accent = tweaks.accentTreatment;
  }, [tweaks]);

  let view = null;
  if (route.view === 'projects') {
    view = <ProjectsView
      projects={D.PROJECTS}
      portfolio={D.PORTFOLIO_SUMMARY}
      today={D.TODAY}
      helpers={D.helpers}
      setRoute={setRoute}
    />;
  } else if (route.view === 'project-detail') {
    const project = D.PROJECTS.find(p => p.id === route.projectId);
    view = <ProjectDetail
      project={project}
      today={D.TODAY}
      helpers={D.helpers}
      allocations={D.ALLOCATIONS}
      setRoute={setRoute}
    />;
  } else if (route.view === 'capacity') {
    view = <CapacityView
      team={D.TEAM}
      projects={D.PROJECTS}
      allocations={D.ALLOCATIONS}
      teamSummary={D.TEAM_SUMMARY}
      helpers={D.helpers}
    />;
  }

  return (
    <div id="app">
      <Sidebar route={route} setRoute={setRoute} portfolio={D.PORTFOLIO_SUMMARY} />
      <div className="main" data-screen-label={
        route.view === 'projects' ? '01 Projects'
        : route.view === 'project-detail' ? '02 Project Detail'
        : '03 Capacity'
      }>
        <Topbar route={route} setRoute={setRoute} />
        {view}
      </div>

      <window.TweaksPanel title="Tweaks">
        <window.TweakSection label="Layout">
          <window.TweakRadio
            label="Table density"
            value={tweaks.density}
            onChange={v => setTweak('density', v)}
            options={['comfortable', 'compact']}
          />
        </window.TweakSection>
        <window.TweakSection label="Brand">
          <window.TweakRadio
            label="Accent treatment"
            value={tweaks.accentTreatment}
            onChange={v => setTweak('accentTreatment', v)}
            options={['branded', 'restrained']}
          />
        </window.TweakSection>
      </window.TweaksPanel>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
