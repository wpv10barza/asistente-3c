/** @license SPDX-License-Identifier: Apache-2.0 */
import React, { useEffect, useRef, useState } from 'react';
import { GoogleOAuthProvider, useGoogleLogin } from '@react-oauth/google';
import { Mic, MicOff, LogIn, CheckCircle2, AlertCircle, Loader2, Send } from 'lucide-react';

type AppConfig = { clientId: string; spreadsheetId: string; sheetName: string; headerRow: number; searchColumn: string };
type Operation = { campo: string; columna_actualizar: string; encabezado: string; valor_actualizar: string | number; razon?: string };
type PendingPlan = { row: number; matched: string; operations: Operation[]; externalCommandId?: string; reviewProposalId?: string };
type DeviceCommand = { id: string; device_id: string; text: string; created_at: string };

const normalizeText = (value: unknown) => String(value ?? '')
  .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

function findUniqueRow(rows: unknown[][], query: string, dataStartRow: number) {
  const target = normalizeText(query);
  if (!target) return { error: 'No se indicó la tarea que debe buscarse.' };
  const candidates = rows.map((r, index) => ({ row: dataStartRow + index, raw: String(r?.[0] ?? ''), normalized: normalizeText(r?.[0]) })).filter(x => x.normalized);
  const exact = candidates.filter(x => x.normalized === target);
  if (exact.length === 1) return { row: exact[0].row, matched: exact[0].raw };
  if (exact.length > 1) return { error: `Hay ${exact.length} coincidencias exactas. Use el TareaId para evitar modificar la fila equivocada.` };
  const partial = candidates.filter(x => x.normalized.includes(target) || target.includes(x.normalized));
  if (partial.length === 1) return { row: partial[0].row, matched: partial[0].raw };
  if (partial.length > 1) return { error: `La búsqueda es ambigua: ${partial.length} tareas coinciden. Dicte un nombre más completo o el TareaId.` };
  return { error: `No se encontró la tarea "${query}".` };
}

function MainApp({ token, config }: { token: string; config: AppConfig }) {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [inputText, setInputText] = useState('');
  const [status, setStatus] = useState<{ type: 'idle'|'loading'|'preview'|'success'|'error'; message: string }>({ type: 'idle', message: '' });
  const [lastOperations, setLastOperations] = useState<Operation[]>([]);
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);
  const [deviceCommand, setDeviceCommand] = useState<DeviceCommand | null>(null);
  const recognitionRef = useRef<any>(null);
  const lastSeenDeviceCommandRef = useRef('');

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return setStatus({ type: 'error', message: 'Tu navegador no soporta reconocimiento de voz.' });
    const recognition = new SpeechRecognition();
    recognition.lang = 'es-PE'; recognition.continuous = false; recognition.interimResults = false;
    recognition.onresult = (event: any) => { const text = event.results[event.resultIndex][0].transcript; setTranscript(text); prepareCommand(text); };
    recognition.onerror = (event: any) => { setStatus({ type: 'error', message: `Error de voz: ${event.error}` }); setIsRecording(false); };
    recognition.onend = () => setIsRecording(false);
    recognitionRef.current = recognition;
  }, [token]);

  const sheetsFetch = async (range: string, init?: RequestInit) => {
    const encodedRange = encodeURIComponent(`${config.sheetName}!${range}`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${encodedRange}${init?.method === 'PUT' ? '?valueInputOption=USER_ENTERED' : ''}`;
    const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    if (!response.ok) throw new Error(`Google Sheets respondió ${response.status}. Verifica permisos, hoja y rango.`);
    return response.json();
  };

  const prepareCommand = async (text: string, externalCommandId?: string) => {
    setPendingPlan(null); setLastOperations([]); setStatus({ type: 'loading', message: 'Auditando columnas reales de la hoja...' });
    try {
      const headerData = await sheetsFetch(`A${config.headerRow}:AF${config.headerRow}`);
      const headerValues: string[] = headerData.values?.[0] || [];
      const detectedHeaders = Object.fromEntries(headerValues.map((value, index) => {
        let n = index + 1, letters = ''; while (n) { const r = (n - 1) % 26; letters = String.fromCharCode(65 + r) + letters; n = Math.floor((n - 1) / 26); } return [letters, value];
      }));
      if (detectedHeaders.F !== 'Nombre' || detectedHeaders.E !== 'TareaId') throw new Error('La plantilla no coincide: se esperaba E=TareaId y F=Nombre. No se realizó ningún cambio.');

      const dataStartRow = config.headerRow + 1;
      const [bcData, noData] = await Promise.all([
        sheetsFetch(`B${dataStartRow}:C`),
        sheetsFetch(`N${dataStartRow}:O`),
      ]);
      const uniqueColumn = (rows: unknown[][], index: number) => Array.from(new Set(rows.map(row => String(row?.[index] ?? '').trim()).filter(Boolean)));
      const detectedCatalogs = {
        item_mantenible: uniqueColumn(bcData.values || [], 0),
        modo_falla: uniqueColumn(bcData.values || [], 1),
        especialidad: uniqueColumn(noData.values || [], 0),
        labour1: uniqueColumn(noData.values || [], 1),
      };

      setStatus({ type: 'loading', message: 'Interpretando el comando y validando las reglas 3C...' });
      const extractionResponse = await fetch('/api/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, detectedHeaders, detectedCatalogs }) });
      const data = await extractionResponse.json();
      if (!extractionResponse.ok) throw new Error(data.error || 'No se pudo interpretar el comando.');
      if (data.requiere_revision) throw new Error(data.motivo_revision || 'El comando requiere revisión manual.');

      const searchColumn = data.columna_busqueda === 'E' ? 'E' : 'F';
      const searchValue = searchColumn === 'E' ? data.tarea_id : data.tarea_buscada;
      setStatus({ type: 'loading', message: `Buscando de forma única en columna ${searchColumn}...` });
      const searchData = await sheetsFetch(`${searchColumn}${dataStartRow}:${searchColumn}`);
      const found = findUniqueRow(searchData.values || [], searchValue, dataStartRow);
      if (!found.row) throw new Error(found.error);

      const reviewResponse = await fetch('/api/review/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          row: found.row,
          matched: found.matched || searchValue,
          operations: data.operaciones,
          externalCommandId,
        }),
      });
      const reviewData = await reviewResponse.json();
      if (!reviewResponse.ok) throw new Error(reviewData.error || 'No se pudo reservar la revisión analítica.');
      setPendingPlan({
        row: found.row,
        matched: found.matched || searchValue,
        operations: data.operaciones,
        externalCommandId,
        reviewProposalId: reviewData.id,
      });
      setStatus({ type: 'preview', message: `Vista previa lista para la fila ${found.row}. Revise los cambios y confirme para escribir.` });
    } catch (error: any) {
      console.error(error); setStatus({ type: 'error', message: error.message || 'Ocurrió un error inesperado.' });
    }
  };

  const reportDeviceResult = async (commandId: string | undefined, resultStatus: 'applied'|'rejected', result: string) => {
    if (!commandId) return;
    try {
      await fetch(`/api/device/v1/commands/${encodeURIComponent(commandId)}/result`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: resultStatus, result })
      });
    } catch (error) {
      console.warn('No se pudo cerrar el comando del dispositivo.', error);
    }
  };

  const confirmPendingPlan = async () => {
    if (!pendingPlan) return;
    setStatus({ type: 'loading', message: `Aplicando ${pendingPlan.operations.length} cambio(s) en la fila ${pendingPlan.row}...` });
    try {
      for (const operation of pendingPlan.operations) {
        await sheetsFetch(`${operation.columna_actualizar}${pendingPlan.row}`, { method: 'PUT', body: JSON.stringify({ values: [[operation.valor_actualizar]] }) });
      }
      if (pendingPlan.reviewProposalId) {
        const reviewResponse = await fetch(`/api/review/proposals/${encodeURIComponent(pendingPlan.reviewProposalId)}/approve`, { method: 'POST' });
        const reviewData = await reviewResponse.json();
        if (!reviewResponse.ok) throw new Error(reviewData.error || 'No se pudo cerrar la revisión analítica.');
      }
      const message = `Fila ${pendingPlan.row} actualizada: ${pendingPlan.matched}. Se aplicaron ${pendingPlan.operations.length} cambio(s).`;
      setLastOperations(pendingPlan.operations);
      await reportDeviceResult(pendingPlan.externalCommandId, 'applied', message);
      setPendingPlan(null);
      setStatus({ type: 'success', message });
    } catch (error: any) {
      if (pendingPlan.reviewProposalId) {
        await fetch(`/api/review/proposals/${encodeURIComponent(pendingPlan.reviewProposalId)}/reject`, { method: 'POST' }).catch(() => undefined);
      }
      console.error(error); setStatus({ type: 'error', message: error.message || 'No se pudieron aplicar los cambios.' });
    }
  };

  const rejectPendingPlan = async () => {
    if (!pendingPlan) return;
    if (pendingPlan.reviewProposalId) {
      await fetch(`/api/review/proposals/${encodeURIComponent(pendingPlan.reviewProposalId)}/reject`, { method: 'POST' }).catch(() => undefined);
    }
    await reportDeviceResult(pendingPlan.externalCommandId, 'rejected', 'El usuario rechazo la vista previa.');
    setPendingPlan(null);
    setStatus({ type: 'idle', message: '' });
  };

  const toggleRecording = () => {
    if (isRecording) { recognitionRef.current?.stop(); setIsRecording(false); }
    else { setTranscript(''); setStatus({ type: 'idle', message: '' }); recognitionRef.current?.start(); setIsRecording(true); }
  };

  useEffect(() => {
    let active = true;
    const pollDevice = async () => {
      try {
        const after = lastSeenDeviceCommandRef.current ? `?after=${encodeURIComponent(lastSeenDeviceCommandRef.current)}` : '';
        const response = await fetch(`/api/device/v1/commands/pending${after}`);
        if (!response.ok) return;
        const data = await response.json();
        if (!active || !data.command || data.command.id === lastSeenDeviceCommandRef.current) return;
        lastSeenDeviceCommandRef.current = data.command.id;
        setDeviceCommand(data.command);
      } catch {
        // El backend puede estar reiniciandose; el siguiente ciclo reintenta.
      }
    };
    pollDevice();
    const timer = window.setInterval(pollDevice, 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  return <div className="flex flex-col items-center justify-center p-8 bg-white rounded-2xl shadow-xl max-w-2xl w-full border border-gray-100">
    <div className="text-center mb-8"><h2 className="text-2xl font-bold text-gray-900 mb-2">Automatización 3C</h2><p className="text-gray-500 text-sm">Mapeo seguro de comandos de voz a Google Sheets</p></div>
    <button onClick={toggleRecording} className={`w-28 h-28 rounded-full flex items-center justify-center shadow-lg ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-blue-600'}`}>{isRecording ? <MicOff className="w-11 h-11 text-white"/> : <Mic className="w-11 h-11 text-white"/>}</button>
    <p className="mt-5 text-sm font-medium text-gray-600">{isRecording ? 'Escuchando...' : 'Toca para hablar o escribe el comando'}</p>
    <form onSubmit={e => { e.preventDefault(); if (inputText.trim()) { setTranscript(inputText); prepareCommand(inputText); setInputText(''); } }} className="w-full mt-6 relative">
      <input value={inputText} onChange={e => setInputText(e.target.value)} placeholder='Ej. Cambia la tarea Inspección J10 a cada 3 meses' className="w-full pl-4 pr-12 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"/>
      <button type="submit" disabled={!inputText.trim() || status.type === 'loading'} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-blue-600 disabled:opacity-50"><Send className="w-5 h-5"/></button>
    </form>
    {deviceCommand && <div className="mt-5 w-full p-4 bg-amber-50 rounded-xl border border-amber-200">
      <p className="text-sm font-semibold text-amber-900">Comando recibido de {deviceCommand.device_id}</p>
      <p className="mt-1 text-sm text-amber-950">{deviceCommand.text}</p>
      <div className="mt-3 flex gap-2">
        <button onClick={() => { setTranscript(deviceCommand.text); prepareCommand(deviceCommand.text, deviceCommand.id); setDeviceCommand(null); }} disabled={status.type === 'loading'} className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium disabled:opacity-50">Revisar comando</button>
        <button onClick={async () => { await reportDeviceResult(deviceCommand.id, 'rejected', 'El usuario descarto el comando sin procesarlo.'); setDeviceCommand(null); }} className="px-4 py-2 rounded-lg border border-amber-300 text-sm font-medium">Descartar</button>
      </div>
    </div>}
    {transcript && <div className="mt-6 w-full p-4 bg-gray-50 rounded-xl border"><p className="text-sm text-gray-500 mb-1 font-medium">Comando</p><p className="text-gray-900 italic">“{transcript}”</p></div>}
    {pendingPlan && <div className="mt-4 w-full rounded-xl border border-amber-300 overflow-hidden">
      <div className="px-4 py-3 bg-amber-50"><p className="font-semibold text-sm">Cambios por confirmar · fila {pendingPlan.row}</p><p className="text-xs text-gray-600 mt-1">{pendingPlan.matched}</p></div>
      {pendingPlan.operations.map((op, i) => <div key={i} className="px-4 py-2 text-sm border-t flex justify-between gap-4"><span>{op.columna_actualizar} · {op.encabezado}</span><strong className="text-right break-all">{String(op.valor_actualizar)}</strong></div>)}
      <div className="p-3 border-t flex gap-2 justify-end"><button onClick={rejectPendingPlan} className="px-4 py-2 rounded-lg border text-sm font-medium">Cancelar</button><button onClick={confirmPendingPlan} className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium">Confirmar y aplicar</button></div>
    </div>}
    {lastOperations.length > 0 && <div className="mt-4 w-full rounded-xl border overflow-hidden"><div className="px-4 py-2 bg-gray-50 font-semibold text-sm">Cambios aplicados</div>{lastOperations.map((op, i) => <div key={i} className="px-4 py-2 text-sm border-t flex justify-between gap-4"><span>{op.columna_actualizar} · {op.encabezado}</span><strong className="text-right break-all">{String(op.valor_actualizar)}</strong></div>)}</div>}
    {status.type !== 'idle' && <div className={`mt-6 w-full p-4 rounded-xl flex items-start gap-3 ${status.type === 'error' ? 'bg-red-50' : status.type === 'success' ? 'bg-green-50' : status.type === 'preview' ? 'bg-amber-50' : 'bg-blue-50'}`}>
      {status.type === 'loading' && <Loader2 className="w-5 h-5 text-blue-600 animate-spin shrink-0"/>}{status.type === 'preview' && <AlertCircle className="w-5 h-5 text-amber-600 shrink-0"/>}{status.type === 'success' && <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0"/>}{status.type === 'error' && <AlertCircle className="w-5 h-5 text-red-600 shrink-0"/>}<p className="text-sm">{status.message}</p>
    </div>}
  </div>;
}

function LoginButton({ setToken }: { setToken: (token: string) => void }) {
  const login = useGoogleLogin({ scope: 'https://www.googleapis.com/auth/spreadsheets', onSuccess: r => setToken(r.access_token), onError: e => console.error(e) });
  return <div className="p-8 bg-white rounded-2xl shadow-xl max-w-md w-full text-center"><LogIn className="w-12 h-12 text-blue-600 mx-auto mb-4"/><h2 className="text-2xl font-bold mb-2">Conectar cuenta</h2><p className="text-gray-500 mb-6">Autoriza el acceso para actualizar la estrategia 3C.</p><button onClick={() => login()} className="w-full border px-6 py-3 rounded-xl hover:bg-gray-50 font-medium">Continuar con Google</button></div>;
}

export default function App() {
  const e2eMode = import.meta.env.VITE_E2E_MODE === 'true';
  const [config, setConfig] = useState<AppConfig | null>(e2eMode ? {
    clientId: 'ci-e2e',
    spreadsheetId: 'ci-sheet',
    sheetName: 'Data',
    headerRow: 4,
    searchColumn: 'F',
  } : null);
  const [token, setToken] = useState<string | null>(e2eMode ? 'ci-e2e-token' : null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (e2eMode) return;
    fetch('/api/config').then(r => r.json()).then(d => d.clientId ? setConfig(d) : setError(d.error || 'Configuración inválida.')).catch(() => setError('Error al cargar configuración.'));
  }, [e2eMode]);
  if (error) return <div className="min-h-screen flex items-center justify-center p-4 text-red-600">{error}</div>;
  if (!config) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-blue-600"/></div>;
  if (e2eMode) return <MainApp token={token || 'ci-e2e-token'} config={config}/>;
  return <GoogleOAuthProvider clientId={config.clientId}><div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">{token ? <MainApp token={token} config={config}/> : <LoginButton setToken={setToken}/>}</div></GoogleOAuthProvider>;
}
