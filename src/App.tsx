/**
 * StructBOQ: structural concrete takeoff read in the browser, in four checked steps —
 * import the drawing (and check what was read), review, quantities (ปร.4 / ปร.5), compare with the real BOQ.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header, type AppTab } from './components/Header';
import type { CompletenessFinding } from './engine/sheetMerge';
import { compareTakeoffWithBoq } from './engine/boqCompare';
import * as XLSX from 'xlsx';
import { buildBoqWorkbook, workbookFileName } from './export/excelWorkbook';
import { DocSourceContext } from './pdf/docContext';
import type { PdfDoc } from './pdf/browserPipeline';
import { ReviewWorkspace } from './components/ReviewWorkspace';
import { ReadingLog, type ReadingLogData } from './components/ReadingLog';
import { logEntryFor, addEntry, undoEntry, readingSignature, type ReviewLogEntry } from './engine/reviewLog';
import { BoqComparison, type BoqState, type DatasetInfo } from './components/BoqComparison';
import { UploadSection } from './components/UploadSection';
import { SummaryCards } from './components/SummaryCards';
import { QuantityTable } from './components/QuantityTable';
import { TraceabilityModal } from './components/TraceabilityModal';
import { ManualCalculator } from './components/ManualCalculator';
import { MaterialSpecsModal } from './components/MaterialSpecsModal';
import { FactorFModal } from './components/FactorFModal';
import { OfficialReportModal } from './components/OfficialReportModal';
import { SAMPLE_PROJECTS, SampleProject } from './data/sampleProjects';
import {
  computeProject,
  approvalFor,
  calcSnapshot,
  fingerprintOf,
  type DrawingRef,
  BOQProjectResult,
  CalculatedQuantity,
  ExtractedMember,
  MaterialSpecs,
  DEFAULT_MATERIAL_SPECS,
  normalizeMaterialSpecs,
  FactorFParams,
  DEFAULT_FACTOR_F_PARAMS,
} from './engine/qsEngine';
import type { Language } from './utils/translations';
import { swapDoc as swapSlot, destroyOnError } from './pdf/docLifecycle';
import { CheckCircle2, XCircle, Info, X, ClipboardCheck } from 'lucide-react';

import { fileIdentity as fileDrawing, fileKey } from './pdf/fileIdentity';
import type { PageSelection } from './pdf/pageSelection';
const revisionOf = (d: DrawingRef) => `${d.file} · ${d.sha256 ? d.sha256.slice(0, 16) : '(ไม่มี hash: เบราว์เซอร์ไม่อนุญาต)'}`;

export default function App() {
  const lang: Language = 'th';
  const theme = 'light' as const;

  const [activeTab, setActiveTab] = useState<AppTab>('import');
  const [selectedSampleId, setSelectedSampleId] = useState<string>('');
  
  // Material Specs & Unit Rates
  const [activeMaterialSpecs, setActiveMaterialSpecs] = useState<MaterialSpecs>(DEFAULT_MATERIAL_SPECS);
  const [isMaterialModalOpen, setIsMaterialModalOpen] = useState(false);

  // Factor F Parameters (แบบ ปร.5)
  const [activeFactorFParams, setActiveFactorFParams] = useState<FactorFParams>(DEFAULT_FACTOR_F_PARAMS);
  const [isFactorFModalOpen, setIsFactorFModalOpen] = useState(false);

  // Official Report Print Modal
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  // Store raw members so we can append custom ones cleanly
  const [activeMembers, setActiveMembers] = useState<ExtractedMember[]>([]);
  // Starts empty: nothing is shown until a drawing (or a demo) is opened
  const [currentProject, setCurrentProject] = useState<BOQProjectResult>(() => computeProject([], '', DEFAULT_MATERIAL_SPECS, DEFAULT_FACTOR_F_PARAMS));
  const [readingLog, setReadingLog] = useState<ReadingLogData | null>(null);
  const [ocrPages, setOcrPages] = useState<any[]>([]);
  const [reviewLog, setReviewLog] = useState<ReviewLogEntry[]>([]);
  /** typed reviewer name (kept in this browser) and the opened drawing file as name · SHA-256 prefix */
  const [reviewer, setReviewer] = useState(() => { try { return localStorage.getItem('structboq_reviewer') || ''; } catch { return ''; } });
  const [revision, setRevision] = useState<string>();
  /** the opened drawing file every approval is bound to (null for samples and datasets) */
  const drawingRef = useRef<DrawingRef | null>(null);
  /** stops the read in progress (a file read in this browser can take minutes) */
  const readAbort = useRef<AbortController | null>(null);
  const compute = (members: ExtractedMember[], name: string, specs: MaterialSpecs, factorF: FactorFParams) =>
    computeProject(members, name, specs, factorF, drawingRef.current);
  const changeReviewer = (name: string) => {
    setReviewer(name);
    try { localStorage.setItem('structboq_reviewer', name); } catch { /* blocked storage: name lasts this session */ }
  };
  const stamp = <T,>(x: T): T => ({ ...x, by: reviewer.trim() || undefined, revision });
  /** storage key + the reading the saved review was made on */
  const reviewStore = useRef<{ key: string; base: string } | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [selectedItemForTrace, setSelectedItemForTrace] = useState<CalculatedQuantity | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Source drawing loaded in the browser (pages rendered locally for evidence) and the real BOQ
  const [docId, setDocId] = useState<string | undefined>(undefined);
  const drawingDoc = useRef<{ doc: PdfDoc; key: string } | null>(null);
  const boqDoc = useRef<{ doc: PdfDoc; key: string } | null>(null);
  const [docVersion, setDocVersion] = useState(0);
  const [progress, setProgress] = useState<{ message: string; frac: number } | null>(null);
  const pipeline = () => import('./pdf/browserPipeline');
  const pageUrlFor = (ref: React.MutableRefObject<{ doc: PdfDoc; key: string } | null>) =>
    async (page: number, dpi: number) => {
      if (!ref.current) throw new Error('no document');
      const { renderPageUrl } = await pipeline();
      return renderPageUrl(ref.current.doc, page, dpi, ref.current.key);
    };
  const drawingPageUrl = useCallback(pageUrlFor(drawingDoc), [docVersion]);
  const boqPageUrl = useCallback(pageUrlFor(boqDoc), [docVersion]);
  const swapDoc = (ref: typeof drawingDoc, next: { doc: PdfDoc; key: string } | null) => swapSlot(ref, next, [drawingDoc, boqDoc]);
  const [boq, setBoq] = useState<BoqState | null>(null);
  const [boqVariant, setBoqVariant] = useState<string>('');
  const [isBoqUploading, setIsBoqUploading] = useState(false);
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [loadingDatasetId, setLoadingDatasetId] = useState<string | null>(null);
  const [completeness, setCompleteness] = useState<CompletenessFinding[]>([]);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [activeTab]);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}datasets/index.json`).then(r => r.json()).then(d => setDatasets(d.datasets || [])).catch(() => {});
  }, []);

  /** What the automatic reading produced — a saved review only applies to the same reading. */
  /** Restores reviewer edits, decisions and their history saved for the same drawing in this browser. */
  const restoreReview = (name: string, members: ExtractedMember[]): { members: ExtractedMember[]; log: ReviewLogEntry[] } => {
    const key = `structboq_review2::${name}`;
    const base = readingSignature(members);
    reviewStore.current = { key, base };
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return { members, log: [] };
      const saved = JSON.parse(raw);
      return saved.base === base ? { members: saved.members, log: saved.log || [] } : { members, log: [] };
    } catch {
      return { members, log: [] };
    }
  };
  const saveReview = (members: ExtractedMember[], log: ReviewLogEntry[]) => {
    if (!reviewStore.current) return;
    try {
      localStorage.setItem(reviewStore.current.key, JSON.stringify({ base: reviewStore.current.base, members, log }));
    } catch {
      // storage full or blocked: the review still applies for this session
    }
  };

  const applyExtraction = (data: any, label: string) => {
    setRevision(undefined);
    const members0: ExtractedMember[] = data.members || [];
    const restored0 = restoreReview(data.reviewKey || data.fileName || label, members0);
    const members = restored0.members;
    setReviewLog(restored0.log);
    let effectiveSpecs = activeMaterialSpecs;
    if (data.audit?.material_specs) {
      effectiveSpecs = normalizeMaterialSpecs({ ...activeMaterialSpecs, ...data.audit.material_specs });
      setActiveMaterialSpecs(effectiveSpecs);
    }
    setActiveMembers(members);
    const result = compute(members, data.datasetName || data.fileName || label, effectiveSpecs, activeFactorFParams);
    const a = data.audit || {};
    result.audit = {
      fileName: a.file_name || data.fileName,
      fileType: a.file_type || 'PDF',
      isScanned: !!a.is_scanned,
      pageOrLayerCount: a.page_or_layer_count || 0,
      detectedUnit: a.detected_unit || 'm',
      entitiesParsed: members.length,
      warnings: [...(a.warnings || []), ...(data.mergeNotes || []), ...((data.visionErrors || []).map((e: any) => `Vision อ่านหน้า ${e.page} ไม่สำเร็จ: ${e.error}`))],
      textDensity: a.text_density,
      materialSpecs: effectiveSpecs,
      docId: data.docId,
      pages: a.pages,
    };
    setCurrentProject(result);
    setDocId(data.docId);
    setCompleteness(data.completeness || []);
    if (data.boq) {
      setBoq({ ...data.boq, docId: data.docId });
      const v = data.boq.variants.find((x: string) => data.boqVariant && x.includes(data.boqVariant)) || data.boq.variants[0];
      setBoqVariant(v);
    }
    setSelectedSampleId('');
    setFilterStatus('ALL');
    return { result, restored: members !== members0 };
  };

  /** Runs the in-browser pipeline on a loaded PDF and shows the result. */
  const processPdf = async (doc: PdfDoc, fileName: string, opts: { pages?: string; cachedOcr?: any[]; cachedBoqOcr?: any[]; boqVariant?: string; datasetName?: string; footingVariant?: string; reviewKey?: string; abortSignal?: AbortSignal }) => {
    const key = `${fileName}:${Date.now()}`;
    // the shown document changes only once this file was read: a failed read leaves the previous file on screen
    const out = await destroyOnError(doc, async () => (await pipeline()).extractInBrowser(doc, fileName, { pages: opts.pages, cachedOcr: opts.cachedOcr, cachedBoqOcr: opts.cachedBoqOcr, footingVariant: opts.footingVariant, fileSha: drawingRef.current?.sha256, abortSignal: opts.abortSignal }, (message, frac) => { if (!opts.abortSignal?.aborted) setProgress({ message, frac }); }));
    swapDoc(drawingDoc, { doc, key });
    (window as any).__lastOut = out;
    console.log('out result:', { ocrPages: out.ocrPages.length, readings: out.readings.length, members: out.members.length, warnings: out.warnings });
    if (out.boq) swapDoc(boqDoc, { doc, key });
    const readPages = new Set(out.readings.map(r => r.page));
    setReadingLog({ readings: out.readings, skipped: out.skipped, emptyPages: out.ocrPages.map(p => p.page).filter(p => !readPages.has(p)), notes: out.mergeNotes, timing: out.timing });
    setOcrPages(out.ocrPages || []);
    setDocVersion(v => v + 1);
    return applyExtraction({
      fileName, datasetName: opts.datasetName, reviewKey: opts.reviewKey, docId: 'local', members: out.members, completeness: out.completeness,
      mergeNotes: out.mergeNotes, boq: out.boq, boqVariant: opts.boqVariant,
      audit: {
        file_name: fileName, file_type: out.ocrPages.length ? 'PDF (อ่านในเบราว์เซอร์ + OCR)' : 'PDF (ข้อความดิจิทัล)',
        is_scanned: out.ocrPages.length > 0, page_or_layer_count: out.pageCount, detected_unit: 'm', warnings: out.warnings,
        material_specs: out.materialSpecs,
      },
    }, fileName);
  };

  const handleLoadDataset = async (id: string) => {
    const ds: any = datasets.find(d => d.id === id);
    if (!ds) return;
    setLoadingDatasetId(id);
    drawingRef.current = null;
    try {
      setProgress({ message: `ดาวน์โหลดแบบ ${ds.name}…`, frac: 0.05 });
      const [pdfBuf, ocr, boqOcr] = await Promise.all([
        fetch(`${import.meta.env.BASE_URL}${ds.pdf}`).then(r => { if (!r.ok) throw new Error(r.statusText); return r.arrayBuffer(); }),
        fetch(`${import.meta.env.BASE_URL}${ds.ocr}`).then(r => r.json()),
        ds.boqOcr ? fetch(`${import.meta.env.BASE_URL}${ds.boqOcr}`).then(r => r.json()) : Promise.resolve(null),
      ]);
      const { loadPdf } = await pipeline();
      const doc = await loadPdf(pdfBuf);
      const { result, restored } = await processPdf(doc, ds.pdf.split('/').pop(), { cachedOcr: ocr.pages, cachedBoqOcr: boqOcr?.pages, boqVariant: ds.boqVariant, datasetName: ds.name, footingVariant: ds.footingVariant });
      setNotification({
        message: `${ds.name.split(' — ')[0]}: ${result.totalItemsCount} รายการ · รอตรวจ ${result.needsReviewCount}${restored ? ' · กู้คืนผลตรวจทานเดิม' : ''}`,
        type: 'success',
      });
    } catch (err) {
      setNotification({ message: 'โหลดชุดแบบจริงไม่สำเร็จ: ' + (err as Error).message, type: 'error' });
    } finally {
      setLoadingDatasetId(null);
      setProgress(null);
    }
  };

  const handleUploadBoq = async (file: File) => {
    setIsBoqUploading(true);
    try {
      const { loadPdf } = await pipeline();
      const { toPageText } = await import('./pdf/pdfText');
      const { parseBoqPages, boqTotalsByVariant } = await import('./pdf/boqParser');
      const doc = await loadPdf(await file.arrayBuffer());
      const { parsed, totals } = await destroyOnError(doc, async () => {
        const texts = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const pg = await doc.getPage(i);
          const vp = pg.getViewport({ scale: 1 });
          texts.push(toPageText(i, vp, (await pg.getTextContent()) as any));
        }
        let parsed = parseBoqPages(texts, file.name);
        let totals = boqTotalsByVariant(parsed);
        if (!Object.keys(totals).length) {
          // ปร.4 drawn with outlined Thai fonts: read the pages without a text layer by Thai OCR
          const { ocrBoqInBrowser } = await pipeline();
          const textless = texts.filter(t => t.items.map(i => i.str).join('').trim().length < 40).map(t => t.page);
          const ocrPages = await ocrBoqInBrowser(doc, textless, (message, frac) => setProgress({ message, frac }));
          setProgress(null);
          parsed = parseBoqPages([...texts, ...ocrPages], file.name);
          totals = boqTotalsByVariant(parsed);
          if (Object.keys(totals).length) parsed.warnings.push(`อ่านด้วย OCR ภาษาไทย ${ocrPages.length} หน้า — ตรวจตัวเลขกับหน้า BOQ ก่อนใช้`);
        }
        if (!Object.keys(totals).length) throw new Error('ไม่พบตาราง ปร.4 ที่อ่านได้ในไฟล์นี้');
        return { parsed, totals };
      });
      swapDoc(boqDoc, { doc, key: `${file.name}:${Date.now()}` });
      setDocVersion(v => v + 1);
      setBoq({ fileName: file.name, variants: Object.keys(totals), structuralByVariant: totals, warnings: parsed.warnings, docId: 'local' });
      setBoqVariant(Object.keys(totals)[0]);
      setNotification({ message: `อ่าน BOQ ${file.name} สำเร็จ (${parsed.lines.length} บรรทัด, ${Object.keys(totals).length} รูปแบบ)`, type: 'success' });
    } catch (err) {
      setNotification({ message: 'อ่าน BOQ ไม่สำเร็จ: ' + (err as Error).message, type: 'error' });
    } finally {
      setIsBoqUploading(false);
    }
  };

  /** Members changed by the reviewer: recompute, log the change, remember in this browser. */
  const commitMembers = (next: ExtractedMember[], log: ReviewLogEntry[]) => {
    setActiveMembers(next);
    setReviewLog(log);
    const recomputed = compute(next, currentProject.projectName, activeMaterialSpecs, activeFactorFParams);
    recomputed.audit = currentProject.audit;
    setCurrentProject(recomputed);
    saveReview(next, log);
  };

  const handleUpdateMembers = (updates: { index: number; patch: Partial<ExtractedMember> }[]) => {
    // a decision must say who made it (the review screens ask for the name first; this is the backstop)
    const decided = (u: { index: number; patch: Partial<ExtractedMember> }) => !!u.patch.review && u.patch.review !== activeMembers[u.index]?.review;
    if (updates.some(decided) && !reviewer.trim()) {
      setNotification({ message: 'กรอกชื่อผู้ตรวจก่อนอนุมัติหรือไม่นับ', type: 'error' });
      return;
    }
    const next = activeMembers.map((m, i) => {
      const u = updates.filter(x => x.index === i);
      return u.length ? u.reduce((acc, x) => {
        const merged = { ...acc, ...x.patch };
        if (!decided(x)) return merged;
        // an approval is bound to everything its quantities were calculated from: these specs, this drawing, this engine
        const review = stamp(x.patch.review!);
        return { ...merged, review: review.status === 'approved' ? { ...approvalFor(merged, review.note, activeMaterialSpecs, drawingRef.current), by: review.by, revision: review.revision } : review };
      }, m) : m;
    });
    const entry = logEntryFor(activeMembers, next, updates.map(u => u.index));
    const fp = (m: ExtractedMember) => fingerprintOf(calcSnapshot(m, activeMaterialSpecs, drawingRef.current));
    commitMembers(next, entry ? [...reviewLog, stamp({
      ...entry,
      fingerprintBefore: entry.indices.map(i => fp(activeMembers[i])),
      fingerprintAfter: entry.indices.map(i => fp(next[i])),
      refs: entry.indices.map(i => ({ itemId: currentProject.items.find(it => it.memberIndex === i)?.itemId, tag: next[i].tag, grid: next[i].gridLocation, level: next[i].level })),
    })] : reviewLog);
  };

  const handleUndo = (id: string) => {
    const e = reviewLog.find(x => x.id === id);
    if (!e) return;
    commitMembers(undoEntry(activeMembers, e), reviewLog.map(x => (x.id === id ? { ...x, undoneAt: new Date().toISOString() } : x)));
    setNotification({ message: `ย้อนการแก้ ${e.tags.join(', ')} แล้ว`, type: 'info' });
  };

  const pendingReview = useMemo(
    () => currentProject.items.filter(it => it.status === 'NEEDS_REVIEW' && !it.review).length,
    [currentProject],
  );

  // Switch to another preloaded sample
  const handleSelectSample = (sample: SampleProject) => {
    setSelectedSampleId(sample.id);
    setReadingLog(null);
    setReviewLog([]);
    reviewStore.current = null;
    setRevision(undefined);
    drawingRef.current = null;
    setDocId(undefined);
    swapDoc(drawingDoc, null);
    swapDoc(boqDoc, null);
    setBoq(null);
    setCompleteness([]);
    setActiveMembers(sample.members);
    const computed = compute(sample.members, sample.name, activeMaterialSpecs, activeFactorFParams);
    computed.audit = {
      fileName: sample.fileName,
      fileType: sample.fileFormat === 'HYBRID' ? 'PDF' : sample.fileFormat,
      isScanned: sample.fileFormat === 'HYBRID',
      pageOrLayerCount: sample.fileFormat === 'PDF' ? 2 : 8,
      detectedUnit: sample.fileFormat === 'DXF' && sample.id.includes('warehouse') ? 'mm' : 'm',
      entitiesParsed: sample.members.length,
      warnings: sample.fileFormat === 'HYBRID' ? [lang === 'th' ? 'ตรวจพบชุดทดสอบแบบสแกน; เปิดระบบตรวจสอบภาพสแกน' : 'Scanned drawing test detected; raster image validation active'] : [],
      materialSpecs: activeMaterialSpecs,
    };
    setCurrentProject(computed);
    setFilterStatus('ALL');
    setNotification({
      message: `ตัวอย่างสาธิต (ข้อมูลสมมติ): ${sample.name}`,
      type: 'info',
    });
  };

  // Handle adding custom manual member from the Sandbox
  const handleAddManualMember = (newMember: ExtractedMember) => {
    const updatedMembers = [...activeMembers, newMember];
    setActiveMembers(updatedMembers);
    const log = [...reviewLog, stamp(addEntry([newMember], activeMembers.length, 'เพิ่มเองจากหน้าคำนวณเอง'))];
    setReviewLog(log);
    saveReview(updatedMembers, log);
    const updatedProject = compute(updatedMembers, currentProject.projectName || 'Custom Project', activeMaterialSpecs, activeFactorFParams);
    
    if (currentProject.audit) {
      updatedProject.audit = {
        ...currentProject.audit,
        entitiesParsed: updatedMembers.length,
        materialSpecs: activeMaterialSpecs,
      };
    }

    setCurrentProject(updatedProject);
    setNotification({
      message: `เพิ่ม ${newMember.tag} แล้ว`,
      type: 'success',
    });
  };

  // Handle saving & updating material specifications
  const handleSaveMaterialSpecs = (updatedSpecs: MaterialSpecs) => {
    setActiveMaterialSpecs(updatedSpecs);
    const recomputed = compute(activeMembers, currentProject.projectName || 'Project', updatedSpecs, activeFactorFParams);
    if (currentProject.audit) {
      recomputed.audit = {
        ...currentProject.audit,
        materialSpecs: updatedSpecs,
      };
    }
    setCurrentProject(recomputed);
    setNotification({
      message: `ใช้สเปก ${updatedSpecs.concreteGrade} และคำนวณราคาใหม่แล้ว`,
      type: 'success',
    });
  };

  // Handle saving Factor F parameters
  const handleSaveFactorF = (params: FactorFParams) => {
    setActiveFactorFParams(params);
    const recomputed = compute(activeMembers, currentProject.projectName || 'Project', activeMaterialSpecs, params);
    if (currentProject.audit) {
      recomputed.audit = currentProject.audit;
    }
    setCurrentProject(recomputed);
    setNotification({
      message: `Factor F = ${recomputed.factorF}`,
      type: 'success',
    });
  };

  // Upload of PDF or DXF — read entirely in the browser
  const handleFileUpload = async (file: File, pages?: string, selection?: PageSelection) => {
    setIsProcessing(true);
    setNotification(null);
    const ac = new AbortController();
    readAbort.current = ac;
    // the file on screen keeps its own bytes if this read fails or is stopped: approvals are bound to them
    const shownDrawing = drawingRef.current;
    let finished = false;
    try {
      const drawing = await fileDrawing(file);
      // pages chosen on other bytes are not pages of this file
      if (selection && selection.fileHash !== fileKey(file, drawing)) throw new Error('หน้าที่เลือกเป็นของไฟล์อื่น — เปิดไฟล์แล้วเลือกหน้าใหม่');
      drawingRef.current = drawing;
      // a saved review belongs to these bytes, not to whatever file later has the same name
      const reviewKey = `${file.name}#${drawing.sha256 ?? fileKey(file, drawing)}`;
      const rev = revisionOf(drawing);
      const ext = file.name.split('.').pop()?.toLowerCase();
      let outcome: { result: BOQProjectResult; restored: boolean };
      let foundBoq = false;
      if (ext === 'dxf') {
        const { parseDxf } = await import('./pdf/dxfParser');
        const r = parseDxf(await file.text(), file.name);
        swapDoc(drawingDoc, null);
        setReadingLog(null);
        outcome = applyExtraction({
          fileName: file.name, reviewKey, members: r.members, completeness: [], mergeNotes: [],
          audit: { file_name: file.name, file_type: 'DXF', page_or_layer_count: r.layerCount, detected_unit: r.unit, warnings: r.warnings },
        }, file.name);
        setDocId(undefined);
      } else {
        setProgress({ message: 'เปิดไฟล์ PDF…', frac: 0.02 });
        const { loadPdf } = await pipeline();
        const doc = await loadPdf(await file.arrayBuffer());

        outcome = await processPdf(doc, file.name, { pages, reviewKey, abortSignal: ac.signal });
        foundBoq = !!boqDoc.current && boqDoc.current.doc === doc;
      }
      finished = true;
      const { result, restored } = outcome;
      setRevision(rev);
      setNotification({
        message: `${file.name}: ${result.totalItemsCount} รายการ · รอตรวจ ${result.needsReviewCount}${foundBoq ? ' · พบ BOQ ปร.4 ในไฟล์' : ''}${restored ? ' · กู้คืนผลตรวจทานเดิม' : ''}`,
        type: result.totalItemsCount ? 'success' : 'info',
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setNotification({ message: 'หยุดการอ่านแล้ว — หน้าที่อ่านเสร็จแล้วถูกเก็บไว้ ไม่ต้องอ่านซ้ำ', type: 'info' });
        return;
      }
      console.error('File reading failed', err);
      (window as any).__lastError = (err as any)?.stack || String(err);
      setNotification({
        message: `อ่านแบบไม่สำเร็จ: ${(err as Error).message}`,
        type: 'error',
      });
    } finally {
      if (!finished) drawingRef.current = shownDrawing;
      if (readAbort.current === ac) readAbort.current = null;
      setIsProcessing(false);
      setProgress(null);
    }
  };

  // Export BOQ to Excel (ปร.4, ปร.5, BOQ comparison, review log) — built in the browser
  const handleExportExcel = async () => {
    if (!currentProject || currentProject.items.length === 0) return;
    setIsExporting(true);
    try {
      const wb = buildBoqWorkbook({
        ...currentProject,
        materialSpecs: activeMaterialSpecs,
        factorFParams: activeFactorFParams,
        boqComparison: boq?.structuralByVariant[boqVariant] ? compareTakeoffWithBoq(currentProject, boq.structuralByVariant[boqVariant]) : null,
        boqFileName: boq?.fileName,
        boqVariant,
        reviewLog,
        revision,
      });
      XLSX.writeFile(wb, workbookFileName(currentProject.projectName));
      setNotification({
        message: 'ส่งออก Excel แล้ว (ปร.4, ปร.5, เทียบ BOQ, บันทึกการตรวจทาน)',
        type: 'success',
      });
    } catch (err) {
      console.error('Excel export error', err);
      setNotification({ message: 'ส่งออก Excel ไม่สำเร็จ: ' + (err as Error).message, type: 'error' });
    } finally {
      setIsExporting(false);
    }
  };

  const hasProject = currentProject.items.length > 0;
  // the open trace follows edits and undo (items are recomputed, ids stay the same)
  const traceItem = selectedItemForTrace ? currentProject.items.find(i => i.itemId === selectedItemForTrace.itemId) ?? selectedItemForTrace : null;
  const empty = (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <p className="text-slate-700 font-medium">ยังไม่ได้เปิดแบบ</p>
      <p className="text-sm text-slate-500 mt-1">เริ่มที่ขั้นที่ 1 — เปิดไฟล์แบบ หรือเลือกแบบจริงพร้อม BOQ</p>
      <button onClick={() => setActiveTab('import')} className="mt-4 h-9 px-4 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">ไปขั้นที่ 1</button>
    </div>
  );
  const warnings = currentProject.audit?.warnings || [];

  return (
    <DocSourceContext.Provider value={{ pageUrl: drawingDoc.current ? drawingPageUrl : undefined }}>
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800">
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        reviewPendingCount={pendingReview}
        onExportExcel={handleExportExcel}
        isExporting={isExporting}
        hasItems={hasProject}
        projectName={currentProject.projectName}
        onOpenMaterialSpecs={() => setIsMaterialModalOpen(true)}
        onOpenFactorF={() => setIsFactorFModalOpen(true)}
        onPrintReport={() => setIsReportModalOpen(true)}
      />

      {notification && (
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-3 w-full">
          <div className={`px-3 py-2 rounded-lg border text-sm flex items-center gap-2 ${
            notification.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : notification.type === 'error' ? 'bg-rose-50 border-rose-200 text-rose-900'
              : 'bg-blue-50 border-blue-200 text-blue-900'
          }`}>
            {notification.type === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />}
            {notification.type === 'error' && <XCircle className="w-4 h-4 shrink-0 text-rose-600" />}
            {notification.type === 'info' && <Info className="w-4 h-4 shrink-0 text-blue-600" />}
            <span className="flex-1">{notification.message}</span>
            <button onClick={() => setNotification(null)} className="p-1 rounded hover:bg-black/5" title="ปิด"><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-[1400px] mx-auto px-4 sm:px-6 py-5 w-full space-y-5">
        {activeTab === 'import' && (
          <>
            <UploadSection
              onFileUpload={handleFileUpload}
              onSelectSample={handleSelectSample}
              selectedSampleId={selectedSampleId}
              isProcessing={isProcessing}
              progress={progress}
              onCancelRead={() => readAbort.current?.abort()}
              audit={currentProject.audit}
              datasets={datasets}
              onLoadDataset={handleLoadDataset}
              loadingDatasetId={loadingDatasetId}
            />

            {hasProject && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-sm text-slate-700">
                  อ่านได้ <b className="tabular-nums">{currentProject.totalItemsCount}</b> รายการ ·
                  ผ่าน <b className="tabular-nums text-emerald-700">{currentProject.autoReleaseCount}</b> ·
                  รอตรวจ <b className="tabular-nums text-amber-700">{pendingReview}</b>
                  {currentProject.rejectedCount > 0 && <> · ใช้ไม่ได้ <b className="tabular-nums text-rose-700">{currentProject.rejectedCount}</b></>}
                </div>
                <button onClick={() => setActiveTab('review')} className="ml-auto h-9 px-4 inline-flex items-center gap-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
                  <ClipboardCheck className="w-4 h-4" />ไปตรวจทาน
                </button>
              </div>
            )}

            {readingLog && (
              <section className="rounded-xl border border-slate-200 bg-white p-5">
                <h2 className="text-base font-semibold text-slate-900">ตรวจผลการอ่านแบบ</h2>
                <p className="text-sm text-slate-500 mb-4">แต่ละแผ่นที่อ่าน: ชนิดแผ่น กริด และทุกเบอร์ที่ผูกกับกริดหรืออ่านจากแบบขยาย — คลิกแถวหรือกรอบในแบบเพื่อดูจุดนั้น</p>
                <ReadingLog data={readingLog} pageUrl={drawingDoc.current ? drawingPageUrl : undefined} />
              </section>
            )}

            {warnings.length > 0 && (
              <section className="rounded-xl border border-slate-200 bg-white p-5">
                <h2 className="text-base font-semibold text-slate-900 mb-2">ข้อสังเกตจากการอ่าน</h2>
                <ul className="text-sm text-slate-700 space-y-1 list-disc pl-5">
                  {warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </section>
            )}
          </>
        )}

        {activeTab === 'quantities' && (hasProject ? (
          <>
            <SummaryCards
              items={currentProject.items}
              onSelectItem={item => setSelectedItemForTrace(item)}
              totalVolumeM3={currentProject.totalConcreteVolumeM3}
              totalFormworkM2={currentProject.totalFormworkM2}
              totalItemsCount={currentProject.totalItemsCount}
              autoReleaseCount={currentProject.autoReleaseCount}
              needsReviewCount={currentProject.needsReviewCount}
              rejectedCount={currentProject.rejectedCount}
              passRatePct={currentProject.passRatePct}
              currentFilterStatus={filterStatus}
              onFilterChange={setFilterStatus}
              lang={lang}
              theme={theme}
              totalRebarWeightKg={currentProject.totalRebarWeightKg || 0}
              totalCostThb={currentProject.totalProjectCostThb}
              factorF={currentProject.factorF}
              totalCostWithFactorF={currentProject.totalCostWithFactorF}
              categorySummaries={currentProject.categorySummaries}
              onOpenMaterialSpecs={() => setIsMaterialModalOpen(true)}
              onOpenFactorF={() => setIsFactorFModalOpen(true)}
            />
            <QuantityTable
              items={currentProject.items}
              filterStatus={filterStatus}
              setFilterStatus={setFilterStatus}
              onSelectItem={(item) => setSelectedItemForTrace(item)}
              lang={lang}
              theme={theme}
            />
          </>
        ) : empty)}

        {activeTab === 'review' && (hasProject ? (
          <ReviewWorkspace
            items={currentProject.items}
            members={activeMembers}
            docId={docId}
            theme={theme}
            completeness={completeness}
            onAddSuggested={(idx) => {
              const f = completeness[idx];
              if (!f?.suggested.length) return;
              const next = [...activeMembers, ...f.suggested];
              commitMembers(next, [...reviewLog, stamp(addEntry(f.suggested, activeMembers.length, f.message))]);
              setCompleteness(completeness.filter((_, i) => i !== idx));
              setNotification({ message: `เพิ่ม ${f.suggested.length} ชิ้นส่วนเข้าคิวตรวจ — กรอกค่าที่ขาดแล้วอนุมัติ`, type: 'info' });
            }}
            onUpdateMembers={handleUpdateMembers}
            onAddMember={(m) => {
              const next = [...activeMembers, m];
              commitMembers(next, [...reviewLog, stamp(addEntry([m], activeMembers.length, `เพิ่มชิ้นส่วน ${m.tag} โดยผู้ตรวจ`))]);
              setNotification({ message: `เพิ่ม ${m.tag} เข้าโครงการเรียบร้อยแล้ว`, type: 'success' });
            }}
            onDeleteMember={(idx) => {
              const target = activeMembers[idx];
              if (!target) return;
              const next = activeMembers.filter((_, i) => i !== idx);
              commitMembers(next, reviewLog);
              setNotification({ message: `ลบ ${target.tag} ออกจากโครงการแล้ว`, type: 'info' });
            }}
            ocrPages={ocrPages}
            reviewLog={reviewLog}
            onUndo={handleUndo}
            onOpenItem={setSelectedItemForTrace}
            reviewer={reviewer}
            onReviewerChange={changeReviewer}
            revision={revision}
          />
        ) : empty)}

        {activeTab === 'boq' && (
          <BoqComparison
            result={currentProject}
            boq={boq}
            variant={boqVariant}
            setVariant={setBoqVariant}
            onUploadBoq={handleUploadBoq}
            isUploading={isBoqUploading}
            datasets={datasets}
            onLoadDataset={handleLoadDataset}
            loadingDatasetId={loadingDatasetId}
            pageUrl={boqDoc.current ? boqPageUrl : undefined}
            progress={progress}
            theme={theme}
            onOpenItem={id => {
              const it = currentProject.items.find(i => i.itemId === id);
              if (it) setSelectedItemForTrace(it);
            }}
          />
        )}

        {activeTab === 'manual' && (
          <ManualCalculator onAddMemberToProject={handleAddManualMember} lang={lang} />
        )}
      </main>

      <TraceabilityModal
        item={traceItem}
        member={traceItem?.memberIndex !== undefined ? activeMembers[traceItem.memberIndex] : undefined}
        reviewLog={reviewLog}
        onUndo={handleUndo}
        onGoReview={() => { setSelectedItemForTrace(null); setActiveTab('review'); }}
        docId={docId}
        onClose={() => setSelectedItemForTrace(null)}
        lang={lang}
        theme={theme}
      />
      <MaterialSpecsModal
        isOpen={isMaterialModalOpen}
        onClose={() => setIsMaterialModalOpen(false)}
        specs={activeMaterialSpecs}
        pdfExtractedSpecs={currentProject.audit?.materialSpecs}
        onSave={handleSaveMaterialSpecs}
        lang={lang}
        reviewer={reviewer}
      />
      <FactorFModal
        isOpen={isFactorFModalOpen}
        onClose={() => setIsFactorFModalOpen(false)}
        currentParams={activeFactorFParams}
        onSave={handleSaveFactorF}
        directCost={currentProject.totalProjectCostThb || 0}
      />
      <OfficialReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        result={currentProject}
      />
    </div>
    </DocSourceContext.Provider>
  );
}
