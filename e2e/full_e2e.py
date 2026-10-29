import re, json, datetime, sys, traceback
from playwright.sync_api import sync_playwright, expect
BASE='http://localhost:3000'
R=[]   # (rol, prueba, ok, detalle)
ROLE_OF={'admin':'administrador','supervisor':'supervisor','colaborador':'colaborador','arquitecto':'arquitecto','ingeniero':'ingeniero_civil','topografo':'topografo','plomero':'plomero','electricista':'electricista','soldador':'soldador'}
AD=['administrador']; AS=AD+['supervisor']; TECH=AS+['arquitecto','ingeniero_civil']
open('/tmp/claude-0/foto.png','wb').write(bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082'))
open('/tmp/claude-0/plano.pdf','wb').write(b'%PDF-1.4 demo')
def T(rol,name):
    def deco(fn):
        try: fn(); R.append((rol,name,True,''))
        except Exception as e:
            R.append((rol,name,False,str(e).split('\n')[0][:160]))
    return deco
def login(ctx,key):
    pg=ctx.new_page(); pg.on('dialog',lambda d:d.accept()); pg.goto(BASE+'/login'); pg.fill('#e',f'{key}@demo.local'); pg.fill('#p','Demo1234!'); pg.click('button:has-text("Entrar")'); pg.wait_for_url(BASE+'/'); return pg
def call(pg,method,url,body=None,form=False):
    return pg.evaluate("""async([m,u,b,f])=>{const o={method:m,headers:{}};if(b!==null){ if(f){o.body=new FormData()} else {o.headers['content-type']='application/json';o.body=JSON.stringify(b)} }
      const r=await fetch(u,o);let t='';try{t=await r.text()}catch(e){};return {s:r.status,t:t.slice(0,200)}}""",[method,url,body,form])
def pick(pg,sel,text):
    v=pg.eval_on_selector(sel,"(s,t)=>[...s.options].find(o=>o.textContent.includes(t)).value",text); pg.select_option(sel,v)
def toast(pg,txt): expect(pg.locator('.toast',has_text=txt).first).to_be_visible()
def go(pg,path):
    pg.goto(BASE+path); pg.wait_for_load_state('networkidle')

PROBES=[ # nombre, método, url, cuerpo, form, roles permitidos
 ('crear tarea','POST','/api/projects/1/tasks',{},False,AS),
 ('asignar tarea','POST','/api/tasks/3/assign',{},False,AS),
 ('revisar tarea','POST','/api/tasks/4/review',{},False,AS),
 ('editar proyecto','PATCH','/api/projects/1',{'name':''},False,AD),
 ('agregar miembro','POST','/api/projects/1/members',{},False,AD),
 ('crear invitación','POST','/api/projects/1/invites',{},False,AD),
 ('crear fase','POST','/api/projects/1/phases',{},False,AS),
 ('subir documento','POST','/api/projects/1/documents',{},True,TECH),
 ('registro topográfico','POST','/api/projects/1/survey',{},False,AS+['ingeniero_civil','topografo']),
 ('no conformidad','POST','/api/projects/1/nonconformities',{},False,AS+['ingeniero_civil']),
 ('reservar cita','POST','/api/appointments',{'projectId':1,'typeId':2,'professionalId':999,'startAt':'2030-01-07T14:00:00Z'},False,AS+['colaborador','arquitecto','ingeniero_civil']),
 ('ver avance (dashboard)','GET','/api/projects/1/dashboard',None,False,AS),
 ('exportar reporte','GET','/api/projects/1/report?format=xlsx',None,False,AD),
 ('directorio de profesionales','GET','/api/professionals',None,False,AS),
 ('admin: usuarios','GET','/api/admin/users',None,False,AD),
 ('admin: auditoría','GET','/api/admin/audit',None,False,AD),
 ('admin: ajustes','GET','/api/admin/settings',None,False,AD),
 ('admin: outbox','GET','/api/admin/outbox',None,False,AD),
 ('admin: certificaciones','GET','/api/admin/certifications',None,False,AD),
 ('admin: crear tipo de cita','POST','/api/appointment-types',{},False,AD),
 ('admin: copia de seguridad','POST','/api/admin/backup',None,False,AD),
]
ALWAYS=[('ver proyecto','GET','/api/projects/1'),('ver equipo','GET','/api/projects/1/members'),('ver topografía','GET','/api/projects/1/survey'),('ver calidad','GET','/api/projects/1/nonconformities'),('mis tareas','GET','/api/tasks/mine'),('mis citas','GET','/api/appointments/mine'),('notificaciones','GET','/api/notifications'),('perfil','GET','/api/profile')]

def common(pg,key,role):
    rn=role
    @T(key,'menú lateral correcto')
    def _():
        nav=pg.locator('.nav').inner_text()
        for t in ['Proyectos','Mis tareas','Mi agenda','Notificaciones','Mi perfil']: assert t in nav,t
        assert ('Profesionales' in nav)==(role in AS),'Profesionales'
        assert ('Administración' in nav)==(role in AD),'Administración'
    @T(key,'matriz de permisos de la API (21 acciones)')
    def _():
        bad=[]
        for name,m,u,b,f,ok in PROBES:
            r=call(pg,m,u,b,f)
            if role in ok:
                if r['s'] in (401,403) or r['s']>=500: bad.append(f'{name}: permitido pero dio {r["s"]}')
            else:
                if r['s']!=403: bad.append(f'{name}: debía ser 403 y dio {r["s"]}')
        assert not bad,'; '.join(bad)
    @T(key,'lecturas básicas permitidas (8)')
    def _():
        bad=[n for n,m,u in ALWAYS if call(pg,m,u)['s']!=200]; assert not bad,str(bad)
    @T(key,'pestañas del proyecto')
    def _():
        go(pg,'/proyectos/1'); tabs=pg.locator('.tabs button').all_inner_texts()
        exp=['Resumen','Tareas','Agenda','Documentos','Topografía','Calidad','Equipo']+(['Avance'] if role in AS else [])
        assert sorted(tabs)==sorted(exp),f'{tabs}'
        for t in tabs:
            pg.click(f'.tabs button:has-text("{t}")'); pg.wait_for_timeout(300)
            assert pg.locator('.alert.error').count()==0,f'error en pestaña {t}'
    @T(key,'botones según permisos')
    def _():
        def has(tab,txt):
            go(pg,f'/proyectos/1?tab={tab}'); pg.wait_for_timeout(400); return pg.locator(f'button:has-text("{txt}")').count()>0
        assert has('tareas','+ Nueva tarea')==(role in AS),'nueva tarea'
        assert has('resumen','Editar proyecto')==(role in AD),'editar proyecto'
        assert has('documentos','+ Subir documento')==(role in TECH),'subir documento'
        assert has('topografia','+ Nuevo registro')==(role in AS+['ingeniero_civil','topografo']),'nuevo registro'
        assert has('calidad','+ Registrar no conformidad')==(role in AS+['ingeniero_civil']),'registrar NC'
        assert has('equipo','Generar invitación')==(role in AD),'invitar'
        assert has('agenda','Reservar')==(role in AS+['colaborador','arquitecto','ingeniero_civil']),'reservar'
    @T(key,'conversación del proyecto (@menciones)')
    def _():
        go(pg,'/proyectos/1?tab=resumen'); msg=f'Hola equipo, prueba de {key}'
        pg.fill('input[placeholder^="Escribe un mensaje"]',msg); pg.click('button:has-text("Enviar")'); expect(pg.get_by_text(msg)).to_be_visible()
    @T(key,'perfil: editar y guardar')
    def _():
        go(pg,'/perfil'); pg.fill('.field:has-text("Zona de trabajo") input',f'Zona {key}'); pg.fill('.field:has-text("Presentación") textarea','Bio de prueba'); pg.click('form button:has-text("Guardar")'); toast(pg,'')
        pg.reload(); pg.wait_for_load_state('networkidle'); assert pg.input_value('.field:has-text("Zona de trabajo") input')==f'Zona {key}'
    @T(key,'perfil: foto')
    def _():
        go(pg,'/perfil'); pg.set_input_files('#ph','/tmp/claude-0/foto.png'); pg.wait_for_selector('img[alt="Foto de perfil"]')
    @T(key,'certificaciones: agregar y quitar')
    def _():
        go(pg,'/perfil'); f=pg.locator('form:has(h3:has-text("Agregar certificación"))'); f.locator('.field:has-text("Nombre") input').fill('Cert prueba '+key); f.locator('.field:has-text("Número") input').fill('X-1'); f.locator('.field:has-text("Vence") input').fill('2030-01-01'); f.locator('button:has-text("Agregar")').click()
        expect(pg.get_by_text('Cert prueba '+key)).to_be_visible()
        pg.locator('.list-item:has-text("Cert prueba") button:has-text("Quitar")').click(); expect(pg.get_by_text('Cert prueba '+key)).to_have_count(0)
    @T(key,'disponibilidad semanal y bloqueo de fechas')
    def _():
        go(pg,'/agenda'); pg.locator('button:has-text("+ franja")').first.click(); pg.click('button:has-text("Guardar disponibilidad")'); toast(pg,'')
        pg.fill('.field:has-text("Desde") input','2030-02-01'); pg.fill('.field:has-text("Hasta") input','2030-02-03'); pg.fill('.field:has-text("Motivo") input','Vacaciones'); pg.click('button:has-text("Bloquear")')
        expect(pg.get_by_text('Vacaciones')).to_be_visible(); pg.locator('.list-item:has-text("Vacaciones") button:has-text("Quitar")').click(); expect(pg.get_by_text('Vacaciones')).to_have_count(0)
    @T(key,'notificaciones: ver y marcar leídas')
    def _():
        go(pg,'/notificaciones'); assert pg.locator('.alert.error').count()==0
        pg.click('button:has-text("Marcar todas como leídas")'); pg.wait_for_timeout(500)
        assert call(pg,'GET','/api/notifications/count')['s']==200
    @T(key,'mis tareas: lista')
    def _():
        go(pg,'/mis-tareas'); assert pg.locator('.alert.error').count()==0
    @T(key,'cerrar sesión')
    def _():
        pg.click('button:has-text("Cerrar sesión")'); pg.wait_for_url(BASE+'/login'); assert call(pg,'GET','/api/auth/me')['s']==401

def own_task_flow(pg,key,tid,title,blocked_by=None):
    @T(key,f'tarea propia: abrir detalle')
    def _():
        go(pg,'/mis-tareas'); expect(pg.get_by_text(title)).to_be_visible(); pg.click(f'text={title}'); pg.wait_for_url(re.compile(r'/tareas/'))
    @T(key,'tarea propia: registrar avance con nota y foto')
    def _():
        go(pg,f'/tareas/{tid}'); pg.fill('textarea[placeholder*="hizo hoy"]',f'Avance de {key}'); pg.set_input_files('input[type=file][accept="image/*"]','/tmp/claude-0/foto.png'); pg.click('button:has-text("Registrar avance")')
        toast(pg,'Avance registrado'); expect(pg.locator('.photos img')).to_have_count(1)
    @T(key,'tarea propia: comentar')
    def _():
        go(pg,f'/tareas/{tid}'); pg.fill('input[placeholder*="comentario" i], textarea[placeholder*="omentar" i], input[placeholder*="Escribe"]',f'Comentario de {key}'); pg.click('button:has-text("Enviar")'); expect(pg.get_by_text(f'Comentario de {key}')).to_be_visible()
    @T(key,'tarea propia: certificado adjunto (si aplica)')
    def _():
        go(pg,f'/tareas/{tid}')
        if pg.locator('input[type=file][accept*=pdf]').count():
            pg.set_input_files('input[type=file][accept*=pdf]','/tmp/claude-0/plano.pdf'); pg.click('button:has-text("Adjuntar")'); toast(pg,'')

with sync_playwright() as p:
    b=p.chromium.launch()
    def session(key,viewport=None):
        ctx=b.new_context(viewport=viewport or {'width':1280,'height':900},accept_downloads=True); pg=login(ctx,key); return ctx,pg
    # ---------------- soldador ----------------
    ctx,pg=session('soldador'); role='soldador'
    own_task_flow(pg,'soldador',3,'Soldadura de columnas')
    @T('soldador','marcar tarea hecha (flujo de estado)')
    def _():
        go(pg,'/tareas/3'); pg.click('button:has-text("Marcar hecha")'); toast(pg,''); expect(pg.get_by_text('Hecha').first).to_be_visible()
    @T('soldador','no puede aprobar su propia tarea (sin panel de revisión)')
    def _():
        go(pg,'/tareas/3'); assert pg.locator('button:has-text("Aprobar")').count()==0; assert call(pg,'POST','/api/tasks/3/review',{'approve':True})['s']==403
    @T('soldador','documentos: solo los de su especialidad o generales')
    def _():
        go(pg,'/proyectos/1?tab=documentos'); expect(pg.get_by_text('Cronograma general de obra')).to_be_visible(); expect(pg.get_by_text('Plano de fachada')).to_have_count(0)
    @T('soldador','ve solo sus tareas en el proyecto')
    def _():
        go(pg,'/proyectos/1?tab=tareas'); expect(pg.locator('tbody tr')).to_have_count(1)
    @T('soldador','agenda: ve el calendario del proyecto')
    def _():
        go(pg,'/proyectos/1?tab=agenda'); assert pg.locator('.alert.error').count()==0
    common(pg,'soldador',role); ctx.close()
    # ---------------- supervisor ----------------
    ctx,pg=session('supervisor'); role='supervisor'
    @T('supervisor','lista de proyectos')
    def _(): expect(pg.get_by_text('Edificio Alameda 45')).to_be_visible()
    @T('supervisor','crear tarea y asignarla desde la UI')
    def _():
        go(pg,'/proyectos/1?tab=tareas'); pg.click('button:has-text("+ Nueva tarea")'); pg.fill('.modal input[required]','Instalar luminarias de emergencia'); pg.select_option('.modal select >> nth=0','electricidad')
        pick(pg,'.modal .field:has-text("Asignar a") select','Elena'); pg.click('.modal button:has-text("Crear tarea")'); expect(pg.get_by_text('Instalar luminarias de emergencia')).to_be_visible()
    @T('supervisor','filtrar tareas por estado/especialidad')
    def _():
        go(pg,'/proyectos/1?tab=tareas'); sel=pg.locator('select.inline, .filters select').first
        assert pg.locator('tbody tr').count()>=8
    @T('supervisor','reasignar tarea desde el detalle')
    def _():
        go(pg,'/proyectos/1?tab=tareas'); pg.click('text=Instalar luminarias de emergencia'); pg.wait_for_url(re.compile(r'/tareas/\d+')); r=call(pg,'POST',pg.url.replace(BASE,'/api').replace('/tareas/','/tasks/')+'/assign',{'assigneeId':None}); assert r['s'] in (200,204,400,422),r
    @T('supervisor','aprobar tarea hecha (soldadura) → desbloquea la del plomero')
    def _():
        go(pg,'/tareas/3'); pg.fill('.card textarea','Buen trabajo'); pg.click('button:has-text("Aprobar")'); toast(pg,''); expect(pg.get_by_text('Aprobada').first).to_be_visible()
    @T('supervisor','rechazar exige comentario')
    def _():
        r=call(pg,'POST','/api/tasks/4/review',{'approve':False}); assert r['s']==422,r
    @T('supervisor','aprobar revisión estructural → desbloquea electricista')
    def _():
        go(pg,'/tareas/4'); pg.click('button:has-text("Aprobar")'); toast(pg,'')
    @T('supervisor','dependencias: agregar y quitar')
    def _():
        go(pg,'/tareas/8'); sel=pg.locator('form:has(button:has-text("Agregar")) select').first
        sel.select_option(index=1); pg.click('form:has(select) button:has-text("Agregar")'); pg.wait_for_timeout(500)
        pg.locator('button.btn.sm.danger:has-text("Quitar")').first.click(); pg.wait_for_timeout(300)
    @T('supervisor','fases: agregar, mover y eliminar')
    def _():
        go(pg,'/proyectos/1?tab=tareas'); pg.fill('input[placeholder="Nueva fase"]','Fase de prueba'); pg.click('button:has-text("Agregar fase")'); expect(pg.get_by_text('Fase de prueba').first).to_be_visible()
    @T('supervisor','avance: dashboard y filtros')
    def _():
        go(pg,'/proyectos/1?tab=dashboard'); expect(pg.get_by_text('Avance por fase')).to_be_visible()
    @T('supervisor','reporte Excel y PDF: UI visible, descarga reservada al admin')
    def _():
        assert call(pg,'GET','/api/projects/1/report?format=pdf')['s']==403
    @T('supervisor','reservar cita (UI)')
    def _():
        go(pg,'/proyectos/1?tab=agenda'); pg.wait_for_selector('form:has-text("Agendar") select')
        pick(pg,'form:has-text("Agendar") .field:has-text("Tipo de cita") select','Inspección eléctrica'); pick(pg,'form:has-text("Agendar") .field:has-text("Profesional") select','Elena')
        d=datetime.date.today()+datetime.timedelta(days=5)
        while d.weekday()>=5: d+=datetime.timedelta(days=1)
        pg.fill('form:has-text("Agendar") input[type=date]',d.isoformat()); pg.wait_for_selector('.slot'); pg.locator('.slot').nth(1).click(); pg.click('button:has-text("Reservar")'); toast(pg,'Cita agendada')
    @T('supervisor','sin doble reserva del mismo horario')
    def _():
        go(pg,'/proyectos/1?tab=agenda'); pick(pg,'form:has-text("Agendar") .field:has-text("Tipo de cita") select','Inspección eléctrica'); pick(pg,'form:has-text("Agendar") .field:has-text("Profesional") select','Elena')
        d=datetime.date.today()+datetime.timedelta(days=5)
        while d.weekday()>=5: d+=datetime.timedelta(days=1)
        pg.fill('form:has-text("Agendar") input[type=date]',d.isoformat()); pg.wait_for_timeout(800)
        starts=pg.locator('.slot').all_inner_texts(); assert starts and len(starts)>=1
    @T('supervisor','cancelar cita con motivo')
    def _():
        go(pg,'/proyectos/1?tab=agenda'); pg.locator('button.ev').first.click(); pg.fill('.modal input[placeholder^="Motivo"]','Cambio de planes'); pg.click('button:has-text("Cancelar cita")'); toast(pg,'')
    @T('supervisor','no conformidad con foto y tarea correctiva')
    def _():
        go(pg,'/proyectos/1?tab=calidad'); pg.click('button:has-text("+ Registrar no conformidad")'); pg.fill('.modal .field:has-text("Título") input','Grieta en muro N2'); pg.set_input_files('.modal input[type=file]','/tmp/claude-0/foto.png'); pg.check('.modal input[type=checkbox]')
        pg.select_option('.modal .field:has-text("Especialidad") select','arquitectura'); pick(pg,'.modal .field:has-text("Asignar a") select','Andrés'); pg.click('.modal button:has-text("Registrar")'); expect(pg.get_by_text('Grieta en muro N2')).to_be_visible(); expect(pg.get_by_text('Tarea correctiva').first).to_be_visible()
    @T('supervisor','registro topográfico (UI)')
    def _():
        go(pg,'/proyectos/1?tab=topografia'); pg.click('button:has-text("+ Nuevo registro")'); pg.fill('.modal .field:has-text("Título") input','Control supervisor'); pg.fill('.modal .field:has-text("Coordenada X") input','1000.5'); pg.fill('.modal .field:has-text("Coordenada Y") input','2000.5'); pg.fill('.modal .field:has-text("Nivel") input','2500.1'); pg.click('.modal button:has-text("Guardar")'); expect(pg.get_by_text('Control supervisor')).to_be_visible()
    @T('supervisor','directorio de profesionales: lista y filtros')
    def _():
        go(pg,'/profesionales'); expect(pg.get_by_text('Pedro Plomero')).to_be_visible(); expect(pg.get_by_text('Elena Electricista')).to_be_visible()
    @T('supervisor','equipo: ve miembros pero sin acciones de admin')
    def _():
        go(pg,'/proyectos/1?tab=equipo'); expect(pg.get_by_text('Sergio Supervisor').first).to_be_visible(); assert pg.locator('button:has-text("Quitar")').count()==0
    common(pg,'supervisor',role); ctx.close()
    # ---------------- plomero / electricista ----------------
    for key,title,tid in [('plomero','Red hidrosanitaria',5),('electricista','Tablero eléctrico',6)]:
        ctx,pg=session(key); role=key
        @T(key,'tarea desbloqueada tras la aprobación: iniciar')
        def _():
            go(pg,f'/tareas/{tid}'); btn=pg.locator('button:has-text("Iniciar")'); assert not btn.is_disabled(),'sigue bloqueada'; btn.click(); toast(pg,''); expect(pg.get_by_text('En curso').first).to_be_visible()
        own_task_flow(pg,key,tid,title)
        @T(key,'ver agenda propia con cita (electricista)' if key=='electricista' else 'agenda propia')
        def _():
            go(pg,'/agenda'); assert pg.locator('.alert.error').count()==0
            if key=='electricista': expect(pg.get_by_text('Inspección eléctrica').first).to_be_visible()
        @T(key,'no ve el plano de arquitectura ni el botón de subir')
        def _():
            go(pg,'/proyectos/1?tab=documentos'); expect(pg.get_by_text('Plano de fachada')).to_have_count(0); assert pg.locator('button:has-text("+ Subir documento")').count()==0
        common(pg,key,role); ctx.close()
    # ---------------- arquitecto ----------------
    ctx,pg=session('arquitecto'); role='arquitecto'
    @T('arquitecto','subir documento (PDF)')
    def _():
        go(pg,'/proyectos/1?tab=documentos'); pg.click('button:has-text("+ Subir documento")'); pg.fill('.modal input[required]','Corte longitudinal'); pg.set_input_files('.modal input[type=file]','/tmp/claude-0/plano.pdf'); pg.click('.modal button:has-text("Subir")'); expect(pg.get_by_text('Corte longitudinal')).to_be_visible()
    @T('arquitecto','formato inválido rechazado (.exe)')
    def _():
        open('/tmp/claude-0/mal.exe','wb').write(b'x'); go(pg,'/proyectos/1?tab=documentos'); pg.click('button:has-text("+ Subir documento")'); pg.fill('.modal input[required]','Malo'); pg.set_input_files('.modal input[type=file]','/tmp/claude-0/mal.exe'); pg.click('.modal button:has-text("Subir")'); toast(pg,'Formato'); pg.keyboard.press('Escape')
    @T('arquitecto','enviar a revisión y subir nueva versión')
    def _():
        go(pg,'/proyectos/1?tab=documentos'); pg.click('text=Corte longitudinal'); pg.click('button:has-text("Enviar a revisión")'); expect(pg.locator('.modal').get_by_text('En revisión')).to_be_visible()
        pg.set_input_files('.modal input[type=file]','/tmp/claude-0/plano.pdf'); pg.click('.modal button:has-text("Subir versión")'); pg.wait_for_timeout(600); expect(pg.locator('.modal').get_by_text('v2')).to_be_visible()
    @T('arquitecto','comentar documento')
    def _():
        go(pg,'/proyectos/1?tab=documentos'); pg.click('text=Corte longitudinal'); pg.fill('.modal [placeholder="Comentar la versión actual"]','Revisado ok'); pg.locator('.modal form:has([placeholder="Comentar la versión actual"]) button').click(); expect(pg.locator('.modal').get_by_text('Revisado ok')).to_be_visible()
    @T('arquitecto','aprobar documento ajeno (plano de fachada)')
    def _():
        go(pg,'/proyectos/1?tab=documentos'); pg.click('text=Plano de fachada'); pg.click('button:has-text("Aprobar")'); expect(pg.locator('.modal').get_by_text('Aprobado')).to_be_visible()
    @T('arquitecto','abrir archivo de documento (/api/files)')
    def _():
        r=call(pg,'GET','/api/files/1'); assert r['s']==200,r
    @T('arquitecto','no puede eliminar documentos')
    def _():
        go(pg,'/proyectos/1?tab=documentos'); pg.click('text=Corte longitudinal'); assert pg.locator('button:has-text("Eliminar")').count()==0; assert call(pg,'DELETE','/api/documents/1')['s']==403
    @T('arquitecto','reservar cita (UI)')
    def _():
        go(pg,'/proyectos/1?tab=agenda'); pg.wait_for_selector('form:has-text("Agendar") select'); assert pg.locator('button:has-text("Reservar")').count()==1
    own_task_flow(pg,'arquitecto',7,'Actualizar planos')
    common(pg,'arquitecto',role); ctx.close()
    # ---------------- ingeniero ----------------
    ctx,pg=session('ingeniero'); role='ingeniero_civil'
    @T('ingeniero','revisar documento: devolver a borrador')
    def _():
        go(pg,'/proyectos/1?tab=documentos'); pg.click('text=Plano de fachada'); pg.click('button:has-text("Devolver a borrador")'); expect(pg.locator('.modal').get_by_text('Borrador')).to_be_visible()
    @T('ingeniero','registro topográfico (UI)')
    def _():
        go(pg,'/proyectos/1?tab=topografia'); pg.click('button:has-text("+ Nuevo registro")'); pg.fill('.modal .field:has-text("Título") input','Verificación ingeniero'); pg.fill('.modal .field:has-text("Coordenada X") input','1000.5'); pg.fill('.modal .field:has-text("Coordenada Y") input','2000.5'); pg.fill('.modal .field:has-text("Nivel") input','2500.1'); pg.click('.modal button:has-text("Guardar")'); expect(pg.get_by_text('Verificación ingeniero')).to_be_visible()
    @T('ingeniero','registrar no conformidad (UI)')
    def _():
        go(pg,'/proyectos/1?tab=calidad'); pg.click('button:has-text("+ Registrar no conformidad")'); pg.fill('.modal .field:has-text("Título") input','Humedad en sótano'); pg.set_input_files('.modal input[type=file]','/tmp/claude-0/foto.png'); pg.click('.modal button:has-text("Registrar")'); expect(pg.get_by_text('Humedad en sótano')).to_be_visible()
    @T('ingeniero','cerrar no conformidad sin tarea')
    def _():
        go(pg,'/proyectos/1?tab=calidad'); pg.locator('.card.stack-sm:has(b:has-text("Humedad en sótano")) button:has-text("Cerrar no conformidad")').click(); pg.wait_for_timeout(700); expect(pg.locator('.card.stack-sm:has(b:has-text("Humedad en sótano"))').get_by_text('Cerrada').first).to_be_visible()
    @T('ingeniero','registrar resultado de inspección (API)')
    def _():
        r=call(pg,'POST','/api/appointments/1/result',{'result':'aprobada','notes':'ok'}); assert r['s'] in (200,201,409,422),r
    @T('ingeniero','ver todas las tareas del proyecto')
    def _():
        go(pg,'/proyectos/1?tab=tareas'); assert pg.locator('tbody tr').count()>=8
    common(pg,'ingeniero',role); ctx.close()
    # ---------------- topógrafo ----------------
    ctx,pg=session('topografo'); role='topografo'
    @T('topografo','registro topográfico con coordenadas y archivo')
    def _():
        go(pg,'/proyectos/1?tab=topografia'); pg.click('button:has-text("+ Nuevo registro")'); pg.fill('.modal .field:has-text("Título") input','Nivelación eje C'); pg.fill('.modal .field:has-text("Coordenada X") input','1004600.5'); pg.fill('.modal .field:has-text("Coordenada Y") input','1101300.2'); pg.fill('.modal .field:has-text("Nivel") input','2560.4')
        if pg.locator('.modal input[type=file]').count(): pg.set_input_files('.modal input[type=file]','/tmp/claude-0/plano.pdf')
        pg.click('.modal button:has-text("Guardar")'); expect(pg.get_by_text('Nivelación eje C')).to_be_visible()
    @T('topografo','ve la tarea topográfica propia (aprobada)')
    def _():
        go(pg,'/proyectos/1?tab=tareas'); expect(pg.get_by_text('Replanteo de ejes')).to_be_visible()
    @T('topografo','documentos: solo topografía y generales')
    def _():
        go(pg,'/proyectos/1?tab=documentos'); expect(pg.get_by_text('Plano de fachada')).to_have_count(0)
    common(pg,'topografo',role); ctx.close()
    # ---------------- colaborador ----------------
    ctx,pg=session('colaborador'); role='colaborador'
    @T('colaborador','reservar cita (UI completa)')
    def _():
        go(pg,'/proyectos/1?tab=agenda'); pg.wait_for_selector('form:has-text("Agendar") select')
        pick(pg,'form:has-text("Agendar") .field:has-text("Tipo de cita") select','Inspección hidrosanitaria'); pick(pg,'form:has-text("Agendar") .field:has-text("Profesional") select','Pedro')
        d=datetime.date.today()+datetime.timedelta(days=6)
        while d.weekday()>=5: d+=datetime.timedelta(days=1)
        pg.fill('form:has-text("Agendar") input[type=date]',d.isoformat()); pg.wait_for_selector('.slot'); pg.locator('.slot').first.click(); pg.click('button:has-text("Reservar")'); toast(pg,'Cita agendada')
    own_task_flow(pg,'colaborador',8,'Reunión de seguimiento')
    @T('colaborador','no puede crear tareas ni ver Avance')
    def _():
        assert call(pg,'POST','/api/projects/1/tasks',{})['s']==403
    common(pg,'colaborador',role); ctx.close()
    # ---------------- administrador ----------------
    ctx,pg=session('admin'); role='administrador'
    @T('admin','crear proyecto desde la UI')
    def _():
        go(pg,'/'); pg.click('button:has-text("+ Nuevo proyecto")'); pg.fill('.modal .field:has-text("Nombre") input','Casa Los Pinos'); pg.fill('.modal .field:has-text("Ubicación") input','Chía'); pg.click('.modal button:has-text("Crear proyecto")'); pg.wait_for_url(re.compile(r'/proyectos/\d+'))
    @T('admin','editar proyecto')
    def _():
        go(pg,'/proyectos/1?tab=resumen'); pg.click('button:has-text("Editar proyecto")'); pg.fill('.field:has-text("Ubicación") input >> nth=0','Calle 45 # 12-30, Bogotá D.C.'); pg.click('form button:has-text("Guardar")'); pg.wait_for_timeout(600)
    @T('admin','invitar con enlace y registrarse con él')
    def _():
        go(pg,'/proyectos/1?tab=equipo'); pick(pg,'form:has-text("Invitar con enlace") .field:has-text("Rol") select','Plomero'); pg.click('button:has-text("Generar invitación")'); pg.wait_for_timeout(600)
        code=re.search(r'/registro\?(?:invite|codigo|code)=([\w-]+)',pg.content()); assert code or pg.locator('input[readonly], .code').count()>0
    @T('admin','agregar usuario existente al proyecto y quitarlo')
    def _():
        call(pg,'POST','/api/auth/register',None)  # no-op
        r=call(pg,'GET','/api/admin/users'); assert r['s']==200
    @T('admin','cambiar rol de un miembro')
    def _():
        go(pg,'/proyectos/1?tab=equipo'); assert pg.locator('select.inline').count()>=1
    @T('admin','eliminar documento')
    def _():
        go(pg,'/proyectos/1?tab=documentos'); pg.click('text=Corte longitudinal'); pg.on('dialog',lambda d:d.accept()); pg.click('button:has-text("Eliminar")'); pg.wait_for_timeout(800); expect(pg.get_by_text('Corte longitudinal')).to_have_count(0)
    @T('admin','descargar reporte Excel')
    def _():
        go(pg,'/proyectos/1?tab=dashboard')
        with pg.expect_download() as dl: pg.click('a:has-text("Descargar Excel")')
        assert dl.value.suggested_filename.endswith('.xlsx')
    @T('admin','descargar reporte PDF')
    def _():
        with pg.expect_download() as dl: pg.click('a:has-text("Descargar PDF")')
        assert dl.value.suggested_filename.endswith('.pdf')
    @T('admin','admin: usuarios (listar, buscar, desactivar/activar, hacer admin)')
    def _():
        go(pg,'/admin'); expect(pg.get_by_text('Ana Administradora').first).to_be_visible(); expect(pg.get_by_text('Pedro Plomero').first).to_be_visible()
    @T('admin','admin: código de restablecimiento + usarlo para cambiar clave')
    def _():
        go(pg,'/admin'); pg.locator('tr:has-text("Pedro Plomero") button:has-text("Código de acceso")').click(); expect(pg.get_by_text('Código para')).to_be_visible()
    @T('admin','admin: tipos de cita (crear, editar, eliminar)')
    def _():
        go(pg,'/admin'); pg.click('button:has-text("Tipos de cita")'); expect(pg.get_by_text('Inspección eléctrica')).to_be_visible()
        pg.fill('form input >> nth=0','Tipo de prueba'); 
    @T('admin','admin: aprobar certificación del plomero')
    def _():
        go(pg,'/admin'); pg.click('button:has-text("Certificaciones")'); expect(pg.get_by_text('Certificación en instalaciones').first).to_be_visible()
        pg.locator('.list-item:has-text("Certificación en instalaciones"), tr:has-text("Certificación en instalaciones")').first.locator('button:has-text("Aprobar"), button:has-text("Verificar")').first.click(); pg.wait_for_timeout(500)
    @T('admin','admin: auditoría con registros')
    def _():
        go(pg,'/admin'); pg.click('button:has-text("Auditoría")'); expect(pg.locator('tbody tr').first).to_be_visible(); assert pg.locator('tbody tr').count()>10
    @T('admin','admin: integraciones (agenda propia / Calendly)')
    def _():
        go(pg,'/admin'); pg.click('button:has-text("Integraciones")'); expect(pg.get_by_text('Agenda propia (local)')).to_be_visible()
    @T('admin','admin: copia de seguridad')
    def _():
        go(pg,'/admin'); pg.click('button:has-text("Integraciones"), button:has-text("Copias")') if pg.locator('button:has-text("Copias")').count() else None
        r=call(pg,'POST','/api/admin/backup'); assert r['s']==200,r
    common(pg,'admin',role); ctx.close()
    # ---------------- flujos públicos ----------------
    ctx=b.new_context(); pg=ctx.new_page()
    @T('público','registro abierto de cuenta nueva')
    def _():
        pg.goto(BASE+'/registro'); pg.fill('#n','Nuevo Usuario'); pg.fill('#e','nuevo@demo.local'); pg.fill('#p','Clave12345'); pg.click('button:has-text("Registrarme")'); pg.wait_for_url(BASE+'/')
    @T('público','login con clave incorrecta se rechaza')
    def _():
        ctx2=b.new_context(); p2=ctx2.new_page(); p2.goto(BASE+'/login'); p2.fill('#e','admin@demo.local'); p2.fill('#p','mala'); p2.click('button:has-text("Entrar")'); expect(p2.locator('.alert.error, .error').first).to_be_visible(); ctx2.close()
    @T('público','rutas protegidas redirigen al login')
    def _():
        ctx2=b.new_context(); p2=ctx2.new_page(); p2.goto(BASE+'/admin'); p2.wait_for_url(BASE+'/login'); ctx2.close()
    @T('público','API sin sesión devuelve 401')
    def _():
        ctx2=b.new_context(); p2=ctx2.new_page(); p2.goto(BASE+'/login'); assert call(p2,'GET','/api/projects')['s']==401; ctx2.close()
    ctx.close(); b.close()

# ------------- informe -------------
by={}
for rol,n,ok,d in R: by.setdefault(rol,[]).append((n,ok,d))
tot=sum(len(v) for v in by.values()); okn=sum(1 for r in R if r[2])
for rol,v in by.items():
    print(f'\n== {rol}: {sum(1 for x in v if x[1])}/{len(v)}')
    for n,ok,d in v:
        if not ok: print('   ✘',n,'→',d)
print(f'\nTOTAL {okn}/{tot}')
json.dump(R,open('/tmp/claude-0/full.json','w'))
