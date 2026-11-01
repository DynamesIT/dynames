/* DYNAMES Workspace · Registro membri v0.3 · Frontend statico con Supabase Auth/RLS.
   Nessun secret/service-role key; prima dell'attivazione è obbligatorio il collaudo RLS. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const config = window.DYNAMES_SUPABASE || {};
  const isReady = Boolean(
    config.enableRegistration === true &&
    (location.protocol === 'https:' || location.hostname === 'localhost') &&
    /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(config.url || '') &&
    typeof config.publishableKey === 'string' && config.publishableKey.length > 20 &&
    /^https:\/\//.test(config.privacyNoticeUrl || '') &&
    typeof config.privacyVersion === 'string' && config.privacyVersion.trim().length >= 3
  );
  let client = null, user = null, profile = null, application = null, member = null, admin = false;
  let documents = {};
  let authMode = 'login';
  let recoveryMode = false;
  let busy = false;
  const esc = val => String(val ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const show = (id, visible) => { $(id).hidden = !visible; };
  function message(text, isSuccess = false) { const el = $('alert'); el.textContent = text || ''; el.className = isSuccess ? 'success' : ''; }
  function setBusy(active) { busy = active; document.querySelectorAll('button').forEach(b => { if (!b.dataset.persistent) b.disabled = active; }); }
  function fail(error, fallback = 'Operazione non riuscita.') { console.error('DYNAMES Portal:', error); message(fallback + ' Controlla i dati inseriti o rivolgiti all’amministrazione.'); }
  const demand = (res) => { if (res?.error) throw res.error; return res.data; };
  function setPane(pane) {
    for (const el of document.querySelectorAll('.tab-pane')) el.hidden = el.id !== 'pane-' + pane;
    for (const el of document.querySelectorAll('.workspace-tabs [data-pane]')) el.classList.toggle('active', el.dataset.pane === pane);
    if (pane === 'admin' && admin) refreshAdmin().catch(e => fail(e));
    if (pane === 'documents') refreshDocuments().catch(e => fail(e));
  }
  function renderAuthMode() {
    $('tab-login').classList.toggle('active', authMode === 'login');
    $('tab-signup').classList.toggle('active', authMode === 'signup');
    $('auth-submit').textContent = authMode === 'login' ? 'Accedi' : 'Crea account e verifica email';
    $('auth-help').textContent = authMode === 'login' ?
      'Accedi con il tuo account personale verificato.' :
      'Password di almeno 12 caratteri; dopo la registrazione verifica il link ricevuto via email.';
    $('auth-password').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
    $('auth-confirm-label').hidden = authMode !== 'signup';
    $('auth-password-confirm').required = authMode === 'signup';
    $('forgot-password').hidden = authMode !== 'login';
  }
  async function loadCatalog() {
    const [topics, contributions] = await Promise.all([
      client.from('topics').select('slug,title').order('display_order'),
      client.from('contribution_areas').select('code,title').order('display_order')
    ]);
    const tt = demand(topics), cc = demand(contributions);
    $('topics-box').replaceChildren(...tt.map(t => choice('topic', t.slug, t.title)));
    $('contributions-box').replaceChildren(...cc.map(c => choice('contrib', c.code, c.title)));
  }
  function choice(name, value, label) {
    const el = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox'; input.name = name; input.value = value;
    el.append(input, document.createTextNode(label));
    return el;
  }
  function fillProfile() {
    const form = $('profile-form');
    for (const field of ['first_name','last_name','contact_email','phone','organization','professional_position','biography']) {
      form.elements.namedItem(field).value = profile?.[field] || '';
    }
  }
  async function refreshState() {
    if (!user) return;
    const id = user.id;
    const [p, a, m, g] = await Promise.all([
      client.from('member_profiles').select('*').eq('user_id', id).maybeSingle(),
      client.from('member_applications').select('*').eq('user_id', id).maybeSingle(),
      client.from('members').select('*').eq('user_id', id).maybeSingle(),
      client.from('access_grants').select('id,role_code,scope_type,revoked_at').eq('user_id', id).eq('role_code','super_admin').eq('scope_type','global').is('revoked_at',null)
    ]);
    profile = demand(p); application = demand(a); member = demand(m);
    const grants = demand(g) || [];
    admin = member?.status === 'active' && grants.length > 0;
    $('admin-tab').hidden = !admin;
    $('user-email').textContent = user.email || 'Account';
    $('membership-text').textContent = member?.status === 'active' ? 'Membro DYNAMES attivo' :
      application?.status === 'pending' ? 'Candidatura in valutazione' :
      application?.status === 'rejected' ? 'Candidatura non approvata' : 'Account registrato · nessun incarico assegnato';
    fillProfile();
    const themes = demand(await client.from('member_topics').select('topic_slug').eq('user_id',id)) || [];
    const cs = demand(await client.from('member_contributions').select('area_code').eq('user_id',id)) || [];
    const chosenTopics = new Set(themes.map(t=>t.topic_slug));
    const chosenContribs = new Set(cs.map(c=>c.area_code));
    for (const input of document.querySelectorAll('input[name=topic]')) input.checked = chosenTopics.has(input.value);
    for (const input of document.querySelectorAll('input[name=contrib]')) input.checked = chosenContribs.has(input.value);
    renderApplication();
  }
  function renderApplication() {
    const box = $('application-status');
    if (!application) box.innerHTML = '<p>Nessuna domanda presentata.</p>';
    else if (application.status === 'pending') box.innerHTML = '<p><span class="pill">In valutazione</span> La domanda è stata ricevuta.</p>';
    else if (application.status === 'approved') box.innerHTML = '<p><span class="pill">Approvata</span> La candidatura è stata approvata.</p>';
    else box.innerHTML = '<p><span class="pill">Non approvata</span> Contatta la segreteria DYNAMES per chiarimenti.</p>';
    show('apply-box', !application);
  }
  async function onProfileSave(event) {
    event.preventDefault(); if (busy) return;
    const form = event.currentTarget;
    const fd = new FormData(form);
    const val = k => String(fd.get(k) || '').trim();
    const themes = fd.getAll('topic').map(String);
    if (!themes.length) return message('Seleziona almeno un’area di interesse.');
    if (!val('first_name') || !val('last_name')) return message('Nome e cognome obbligatori.');
    setBusy(true);
    try {
      demand(await client.rpc('save_my_profile', {
        p_first_name: val('first_name'), p_last_name: val('last_name'),
        p_contact_email: val('contact_email'), p_phone: val('phone'),
        p_organization: val('organization'), p_professional_position: val('professional_position'),
        p_biography: val('biography'), p_topics: themes,
        p_contributions: fd.getAll('contrib').map(String)
      }));
      await refreshState(); message('Scheda personale salvata.', true);
    } catch (e) { fail(e,'Impossibile salvare la scheda.'); }
    finally { setBusy(false); }
  }
  async function onApply() {
    if (!profile) return message('Salva prima la tua scheda personale.');
    if (!$('privacy-accept').checked) return message('È necessario confermare la lettura dell’informativa privacy.');
    setBusy(true);
    try {
      demand(await client.from('member_applications').insert({
        user_id:user.id,privacy_notice_version:config.privacyVersion
      }));
      await refreshState(); message('Richiesta inviata. Nessun permesso è stato assegnato automaticamente.',true);
    } catch(e) { fail(e,'Invio della domanda non riuscito.'); }
    finally { setBusy(false); }
  }
  function allowedFile(file,kind) {
    if (!file) throw new Error('Seleziona un file.');
    const photo = kind==='photo';
    const mime = photo?['image/jpeg','image/png','image/webp']:['application/pdf'];
    const ext = file.name.split('.').pop().toLowerCase();
    if (!mime.includes(file.type) || !(photo ? ['jpg','jpeg','png','webp'].includes(ext) : ext==='pdf'))
      throw new Error('Formato file non consentito.');
    if (!file.size || file.size > (photo ? 5 : 10)*1024*1024) throw new Error('Dimensione file non valida.');
    return ext;
  }
  async function refreshDocuments() {
    if (!user) return;
    documents = {};
    const rows = demand(await client.from('member_documents').select('id,document_kind,storage_path,original_filename').eq('user_id',user.id));
    for (const r of rows || []) documents[r.document_kind] = r;
    for (const kind of ['photo','cv']) {
      const el = $(kind+'-display'); el.replaceChildren();
      const d = documents[kind];
      if (!d) {el.textContent='Nessun file presente.'; continue;}
      const name = document.createElement('p'); name.textContent='File: '+d.original_filename; el.appendChild(name);
      const signed = await client.storage.from(config.storageBucket).createSignedUrl(d.storage_path,60);
      if (signed.error) { const t=document.createElement('p'); t.textContent='Anteprima non disponibile.';el.appendChild(t);continue;}
      if (kind==='photo') { const im=document.createElement('img');im.alt='Fotografia del profilo';im.src=signed.data.signedUrl;el.appendChild(im); }
      else { const a=document.createElement('a');a.href=signed.data.signedUrl;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Apri CV (link temporaneo)';el.appendChild(a); }
    }
  }
  async function upload(kind) {
    if (!profile) return message('Salva prima la tua scheda personale.');
    const input = $(kind+'-input'), file=input.files?.[0];
    let ext; try{ext=allowedFile(file,kind)}catch(e){return message(e.message)}
    setBusy(true);
    const path = `${user.id}/${kind}/${crypto.randomUUID()}.${ext}`;
    let uploaded=false;
    try {
      const old = documents[kind] || null;
      const saved = await client.storage.from(config.storageBucket).upload(path,file,{cacheControl:'60',upsert:false,contentType:file.type});
      demand(saved); uploaded=true;
      const data={user_id:user.id,document_kind:kind,storage_path:path,
        original_filename:file.name,mime_type:file.type,size_bytes:file.size};
      if (old) demand(await client.from('member_documents').update(data).eq('id',old.id).eq('user_id',user.id));
      else demand(await client.from('member_documents').insert(data));
      if (old) {
        const cleanup=await client.storage.from(config.storageBucket).remove([old.storage_path]);
        if(cleanup.error) console.warn('Vecchio file da ripulire:',cleanup.error.message);
      }
      input.value='';await refreshDocuments();message('Documento aggiornato nell’archivio privato.',true);
    } catch(e){
      if(uploaded) await client.storage.from(config.storageBucket).remove([path]).catch(()=>{});
      fail(e,'Caricamento non riuscito.');
    } finally {setBusy(false)}
  }
  async function removeDoc(kind) {
    const d = documents[kind]; if(!d) return;
    if(!confirm('Rimuovere il documento '+d.original_filename+'?')) return;
    setBusy(true);
    try {
      // Rimuovere prima i metadati impedisce di mostrare file già cancellati;
      // un errore nella cancellazione Storage richiede una pulizia amministrativa.
      demand(await client.from('member_documents').delete().eq('id',d.id).eq('user_id',user.id));
      const result=await client.storage.from(config.storageBucket).remove([d.storage_path]);
      if(result.error) throw result.error;
      await refreshDocuments();message('Documento rimosso.',true);
    }catch(e){fail(e,'Rimozione incompleta: verificare lo storage.');}
    finally{setBusy(false)}
  }
  async function refreshAdmin() {
    if(!admin) return;
    const apps = demand(await client.from('member_applications')
      .select('user_id,status,submitted_at').eq('status','pending').order('submitted_at',{ascending:true}));
    const profiles = demand(await client.from('member_profiles')
      .select('user_id,first_name,last_name,organization').order('last_name'));
    const byId = new Map(profiles.map(p=>[p.user_id,p]));
    const out=$('admin-applications');out.replaceChildren();
    if(!apps.length) out.textContent='Nessuna candidatura in attesa.';
    for (const a of apps) {
      const p=byId.get(a.user_id);if(!p)continue;
      const row=document.createElement('div');row.className='record';
      const content=document.createElement('div');
      const bold=document.createElement('b');bold.textContent=[p.first_name,p.last_name].join(' ');
      const small=document.createElement('small');small.textContent=(p.organization||'Nessuna organizzazione')+' · In valutazione';
      content.append(bold,small);row.append(content);
      const actions=document.createElement('div');actions.className='actions';
      for(const [decision,label,klass] of [[true,'Approva','primary'],[false,'Rifiuta','danger']]){
        const b=document.createElement('button');b.type='button';b.className=klass;b.textContent=label;
        b.addEventListener('click',()=>review(a.user_id,decision,p.first_name+' '+p.last_name));actions.append(b);
      }
      const cvButton=document.createElement('button');cvButton.type='button';cvButton.className='secondary';cvButton.textContent='CV (se presente)';
      cvButton.addEventListener('click',()=>openApplicantCV(a.user_id));actions.append(cvButton);
      row.append(actions);out.append(row);
    }
    const members = demand(await client.from('members').select('user_id,status,joined_at').order('joined_at',{ascending:false}).limit(200));
    const memBox=$('admin-members');memBox.replaceChildren();
    if(!members.length)memBox.textContent='Nessun membro approvato.';
    for(const m of members){const p=byId.get(m.user_id);const line=document.createElement('div');line.className='record';
      const label=document.createElement('span');label.textContent=(p?`${p.first_name} ${p.last_name}`:'Account')+' · '+m.status;
      line.append(label);memBox.append(line);}
  }
  async function openApplicantCV(id) {
    if(!admin) return;
    try {
      const file = demand(await client.from('member_documents').select('storage_path').eq('user_id',id).eq('document_kind','cv').maybeSingle());
      if(!file) return message('Nessun CV presente nella candidatura.');
      const r=await client.storage.from(config.storageBucket).createSignedUrl(file.storage_path,60);
      demand(r);
      const w=window.open(r.data.signedUrl,'_blank','noopener,noreferrer');
      if(!w) message('Consenti l’apertura del documento nel browser.');
    }catch(e){fail(e,'Impossibile aprire il CV.');}
  }
  async function review(id,decision,fullname){
    if(!admin || !confirm((decision?'Approvare':'Rifiutare')+' la candidatura di '+fullname+'?'))return;
    setBusy(true);
    try{demand(await client.rpc('review_application',{p_user_id:id,p_approve:decision}));
      await refreshAdmin();message('Decisione registrata. Non sono stati assegnati ruoli avanzati.',true);
    }catch(e){fail(e,'Impossibile completare la decisione.');}
    finally{setBusy(false)}
  }
  async function applySession() {
    const result=await client.auth.getUser();
    user = result.error?null:result.data.user;
    show('auth-panel',!user && !recoveryMode);show('account-panel',Boolean(user) && !recoveryMode);
    show('recovery-panel',Boolean(user) && recoveryMode);
    if(!user){profile=null;application=null;admin=false;return;}
    await refreshState();setPane('profile');
  }
  async function submitAuth(event){
    event.preventDefault();if(busy)return;
    const email=$('auth-email').value.trim(),password=$('auth-password').value;
    if(!email||!password||(authMode==='signup' && password.length<12))return message('Email e password richieste; per creare un account servono almeno 12 caratteri.');
    if(authMode==='signup' && password!==$('auth-password-confirm').value)return message('Le due password non coincidono.');
    setBusy(true);
    try{
      if(authMode==='signup'){
        demand(await client.auth.signUp({email,password,
          options:{emailRedirectTo:new URL('member-portal.html',location.href).href}}));
        message('Se la richiesta è accettata, riceverai un’email con il link per verificare l’account.',true);
      }else{
        demand(await client.auth.signInWithPassword({email,password}));
        await applySession();message('Accesso riuscito.',true);
      }
      $('auth-password').value=''; $('auth-password-confirm').value='';
    }catch(e){fail(e,authMode==='signup'?'Registrazione non riuscita.':'Accesso non riuscito.');}
    finally{setBusy(false)}
  }

  async function requestPasswordReset(){
    if(!client || busy) return;
    const email=$('auth-email').value.trim();
    if(!/^\S+@\S+\.\S+$/.test(email)) return message('Inserisci prima la tua email nel campo di accesso.');
    setBusy(true);
    try {
      demand(await client.auth.resetPasswordForEmail(email,{redirectTo:new URL('member-portal.html',location.href).href}));
      message('Se l’indirizzo è registrato, riceverai le istruzioni per recuperare l’accesso.',true);
    } catch(e) {fail(e,'Richiesta di recupero non riuscita.');}
    finally {setBusy(false);}
  }
  async function setNewPassword(event){
    event.preventDefault();if(!client||busy)return;
    const password=$('new-password').value,confirmPassword=$('new-password-confirm').value;
    if(password.length<12 || password!==confirmPassword) return message('Le password devono coincidere e avere almeno 12 caratteri.');
    setBusy(true);
    try {
      demand(await client.auth.updateUser({password}));
      recoveryMode=false;
      $('new-password').value='';$('new-password-confirm').value='';
      await applySession();message('Password aggiornata correttamente.',true);
    } catch(e){fail(e,'Aggiornamento password non riuscito.');}
    finally{setBusy(false);}
  }
  async function start(){
    if(!isReady || !window.supabase?.createClient){
      $('system-banner').textContent='Modalità preparazione: collegamento al database e iscrizioni reali non attivi.';
      $('system-banner').classList.add('warn');show('connect-panel',true);
      if(isReady && !window.supabase?.createClient)message('Libreria Supabase non disponibile.');
      return;
    }
    client=window.supabase.createClient(config.url,config.publishableKey,{auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}});
    $('system-banner').textContent='Connessione configurata. Il database deve essere già stato installato e collaudato.';
    $('system-banner').classList.add('ok');
    $('privacy-link').href=config.privacyNoticeUrl;
    show('auth-panel',true);
    client.auth.onAuthStateChange((event)=>{
      if(event==='PASSWORD_RECOVERY'){
        recoveryMode=true;
        // Il callback Auth non deve eseguire query sincrone con Supabase.
        Promise.resolve().then(()=>{show('auth-panel',false);show('account-panel',false);show('recovery-panel',true);});
      }
      if(event==='SIGNED_OUT'){
        user=null;profile=null;recoveryMode=false;
        Promise.resolve().then(()=>{show('recovery-panel',false);show('account-panel',false);show('auth-panel',true);});
      }
    });
    try{await loadCatalog();await applySession();}catch(e){fail(e,'Errore di connessione o migrazione non installata.');}
  }
  $('tab-login').addEventListener('click',()=>{authMode='login';renderAuthMode();message('');});
  $('tab-signup').addEventListener('click',()=>{authMode='signup';renderAuthMode();message('');});
  $('auth-form').addEventListener('submit',submitAuth);
  $('forgot-password').addEventListener('click',requestPasswordReset);
  $('recovery-form').addEventListener('submit',setNewPassword);
  $('profile-form').addEventListener('submit',onProfileSave);
  $('apply-btn').addEventListener('click',onApply);
  $('photo-upload').addEventListener('click',()=>upload('photo'));
  $('cv-upload').addEventListener('click',()=>upload('cv'));
  $('photo-remove').addEventListener('click',()=>removeDoc('photo'));
  $('cv-remove').addEventListener('click',()=>removeDoc('cv'));
  $('logout').addEventListener('click',async()=>{
    if(!client||busy)return;
    try{demand(await client.auth.signOut());message('Sessione conclusa.',true);}catch(e){fail(e,'Impossibile terminare la sessione.');}
  });
  for(const tab of document.querySelectorAll('[data-pane]'))tab.addEventListener('click',()=>setPane(tab.dataset.pane));
  renderAuthMode();start().catch(e=>fail(e,'Avvio del portale non riuscito.'));
})();
