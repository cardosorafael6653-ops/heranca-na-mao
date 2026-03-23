/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Home, 
  Settings, 
  ChevronRight, 
  Calculator, 
  CheckSquare, 
  MessageSquare, 
  Users,
  ArrowLeft,
  Send,
  Loader2,
  AlertCircle,
  RotateCcw,
  X,
  Download,
  Lock,
  CheckCircle2,
  Unlock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { INITIAL_HEIR_STATE, HeirState, ITCMD_RATES, ASSET_TYPES, DYNAMIC_DOCUMENTS } from './constants';

// --- Types ---
type View = 'dashboard' | 'heirs' | 'itcmd' | 'checklist' | 'chat';

// --- PDF Helpers ---
const generateProtocol = () => {
  const now = new Date();
  const datePart = now.toISOString().slice(0,10).replace(/-/g,'');
  const randomPart = Math.floor(1000 + Math.random() * 9000);
  return `HNM-${datePart}-${randomPart}`;
};

const validateHNM = (code: string) => {
  const regex = /^HNM-(\d{6})-(\d)$/;
  const match = code.match(regex);
  if (!match) return false;

  const numbersPart = match[1];
  const checkDigitProvided = parseInt(match[2], 10);
  const weights = [3, 5, 7, 9, 3, 5];
  let totalSum = 0;
  for (let i = 0; i < 6; i++) {
    totalSum += parseInt(numbersPart[i], 10) * weights[i];
  }
  let calculatedDigit = totalSum % 11;
  if (calculatedDigit === 10) calculatedDigit = 0;
  return calculatedDigit === checkDigitProvided;
};

const formatHNMCode = (val: string) => {
  const digits = val.replace(/[^0-9]/g, '');
  let formatted = '';
  if (digits.length > 0) {
    formatted = 'HNM-';
    formatted += digits.substring(0, 6);
    if (digits.length > 6) {
      formatted += '-' + digits.substring(6, 7);
    }
  }
  return formatted;
};

const addStandardCover = (doc: jsPDF, reportType: string, protocol: string) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR');
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('HERANÇA NA MÃO', pageWidth / 2, 40, { align: 'center' });
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(14);
  doc.text('Relatório de Organização de Inventário', pageWidth / 2, 50, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Tipo do Relatório:', pageWidth / 2, pageHeight / 2 - 10, { align: 'center' });
  doc.setFontSize(18);
  doc.text(reportType, pageWidth / 2, pageHeight / 2 + 5, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Relatório nº ${protocol}`, pageWidth / 2, pageHeight - 40, { align: 'center' });
  doc.text(`Gerado em ${dateStr} às ${timeStr}`, pageWidth / 2, pageHeight - 35, { align: 'center' });
  
  doc.setFont('helvetica', 'italic');
  doc.text('Documento organizacional para apoio na consulta jurídica.', pageWidth / 2, pageHeight - 25, { align: 'center' });
  
  doc.addPage();
};

const addStandardFooter = (doc: jsPDF) => {
  const pageCount = (doc as any).internal.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(150);
    
    const footerText = "Este relatório possui caráter exclusivamente organizacional.\nA análise jurídica definitiva pode variar conforme o caso concreto e legislação aplicável.";
    const lines = doc.splitTextToSize(footerText, pageWidth - 40);
    doc.text(lines, pageWidth / 2, pageHeight - 15, { align: 'center' });
  }
};

// --- Components ---

const getComplexityInfo = (state: HeirState, step: number) => {
  let level: 'green' | 'yellow' | 'red' | 'gray' = 'gray';
  let label = 'Aguardando informações...';
  let recommendation = '';

  if (step > 0) {
    if (state.regime === 'desconhecido') {
      level = 'red';
      label = 'Alta Complexidade (Regime Desconhecido)';
      recommendation = 'Situação juridicamente sensível. Recomenda-se consulta especializada.';
    } else if (state.hasChildren === false && state.hasParents === false && step > 3) {
      level = 'red';
      label = 'Alta Complexidade (Ausência de Herdeiros Diretos)';
      recommendation = 'Situação juridicamente sensível. Recomenda-se consulta especializada.';
    } 
    else if (state.hasChildren === true && state.regime && state.regime !== 'desconhecido' && state.married === true) {
      level = 'green';
      label = 'Estrutura Simples (Descendentes Diretos)';
      recommendation = 'Estrutura sucessória aparentemente simples. Procure advogado para formalização.';
    }
    else if (state.hasChildren === false && state.hasParents === true) {
      level = 'yellow';
      label = 'Atenção Necessária (Ascendentes Vivos)';
      recommendation = 'Estrutura que pode exigir análise detalhada.';
    } else if (state.married === true && state.hasChildren === false) {
      level = 'yellow';
      label = 'Atenção (Cônjuge sem descendentes)';
      recommendation = 'Estrutura que pode exigir análise detalhada.';
    } else if (step > 0) {
      level = 'yellow';
      label = 'Classificação em análise...';
      recommendation = 'Estrutura que pode exigir análise detalhada.';
    }
  }

  return { level, label, recommendation };
};

const ComplexityIndicator = ({ state, step }: { state: HeirState, step: number }) => {
  const { level, label } = getComplexityInfo(state, step);

  const styleMap = {
    green: {
      bg: 'bg-green-50',
      border: 'border-green-400',
      text: 'text-green-700',
      indicator: 'bg-green-500'
    },
    yellow: {
      bg: 'bg-yellow-50',
      border: 'border-yellow-400',
      text: 'text-yellow-700',
      indicator: 'bg-yellow-500'
    },
    red: {
      bg: 'bg-red-50',
      border: 'border-red-400',
      text: 'text-red-700',
      indicator: 'bg-red-500'
    },
    gray: {
      bg: 'bg-gray-50',
      border: 'border-gray-300',
      text: 'text-gray-700',
      indicator: 'bg-gray-400'
    }
  };

  const currentStyle = styleMap[level];

  return (
    <div className={`${currentStyle.bg} p-5 rounded-xl shadow-sm mb-6 border-l-4 ${currentStyle.border}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-3 h-3 rounded-full ${currentStyle.indicator} shadow-sm`} />
        <h3 className={`text-sm font-bold uppercase tracking-wider ${currentStyle.text}`}>Nível de Complexidade</h3>
      </div>
      <p className="font-semibold text-slate-800 mb-1">{label}</p>
      <p className="text-[10px] text-gray-600 mt-2 italic">Classificação organizacional. Pode variar conforme o caso.</p>
    </div>
  );
};

const Disclaimer = () => (
  <div className="bg-amber-50/50 border border-amber-100 p-4 rounded-2xl flex items-start gap-3 mb-6">
    <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
    <p className="text-xs text-amber-900/80 leading-relaxed font-medium">
      <strong>Atenção Institucional:</strong> Este app organiza seus dados para o inventário, mas não substitui a consulta com um advogado.
    </p>
  </div>
);

// --- Layout Component ---
function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col">
      <style>{`
        :root {
          --color-primary: #3B82F6;
          --color-success: #10B981;
          --color-warning: #F59E0B;
          --color-accent: #8B5CF6;
        }
      `}</style>

      <main className="flex-1 pb-6">
        {children}
      </main>
      <footer className="pt-4 pb-10 px-4 text-center border-t border-slate-100 bg-white">
        <p className="text-[9px] text-slate-400/70 leading-relaxed max-w-[80%] mx-auto">
          Este app organiza seus dados para o inventário, mas não substitui a consulta com um advogado.
        </p>
      </footer>
    </div>
  );
}

export default function App() {
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [heirState, setHeirState] = useState<HeirState>(INITIAL_HEIR_STATE);
  const [heirStep, setHeirStep] = useState(0);
  
  // Lifted ITCMD state
  const [itcmdState, setItcmdState] = useState('SP');
  const [itcmdValue, setItcmdValue] = useState('');
  const [itcmdResult, setItcmdResult] = useState<number | null>(null);
  const [isAILiberada, setIsAILiberada] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('isAILiberada');
    if (saved === 'true') setIsAILiberada(true);
  }, []);

  const renderView = () => {
    switch (currentView) {
      case 'dashboard': return <Dashboard setView={setCurrentView} />;
      case 'heirs': return <HeirsFlow state={heirState} setState={setHeirState} step={heirStep} setStep={setHeirStep} onBack={() => setCurrentView('dashboard')} />;
      case 'itcmd': return (
        <ITCMDCalculator 
          state={itcmdState} 
          setState={setItcmdState}
          value={itcmdValue}
          setValue={setItcmdValue}
          result={itcmdResult}
          setResult={setItcmdResult}
          onBack={() => setCurrentView('dashboard')} 
        />
      );
      case 'checklist': return (
        <Checklist 
          heirState={heirState}
          heirStep={heirStep}
          itcmdResult={itcmdResult}
          itcmdUF={itcmdState}
          onBack={() => setCurrentView('dashboard')} 
        />
      );
      case 'chat': return (
        <LegalChat 
          onBack={() => setCurrentView('dashboard')} 
          isAILiberada={isAILiberada}
          setIsAILiberada={setIsAILiberada}
          context={{
            heirState,
            itcmdUF: itcmdState,
            itcmdValue,
            itcmdResult
          }}
        />
      );
      default: return <Dashboard setView={setCurrentView} />;
    }
  };

  return (
    <div className="max-w-md mx-auto min-h-screen relative overflow-hidden">
      <Layout>
        <AnimatePresence mode="wait">
          <motion.div
            key={currentView}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="h-full"
          >
            {renderView()}
          </motion.div>
        </AnimatePresence>
      </Layout>
    </div>
  );
}

// --- Dashboard View ---
function Dashboard({ setView }: { setView: (v: View) => void }) {
  const [openHelpModal, setOpenHelpModal] = useState(false);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenHelpModal(false);
    };
    if (openHelpModal) {
      window.addEventListener('keydown', handleEsc);
    }
    return () => window.removeEventListener('keydown', handleEsc);
  }, [openHelpModal]);

  return (
    <div className="p-6 space-y-8">
      <header className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-blue rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-200">
            <Home size={20} />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 tracking-tight">Herança na Mão</h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Portal de Organização</p>
          </div>
        </div>
        <button 
          onClick={() => setOpenHelpModal(true)}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-white border border-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
        >
          <Settings size={20} />
        </button>
      </header>

      <div className="space-y-1 mt-6">
        <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Olá, Bem-vindo!</h2>
        <p className="text-slate-500 text-sm font-medium">Como podemos organizar seu inventário hoje?</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <DashboardCard 
          color="bg-brand-blue" 
          icon={<Users className="text-white" size={24} strokeWidth={1.5} />}
          title="Herdeiros" 
          subtitle="Triage de estrutura"
          onClick={() => setView('heirs')}
        />
        <DashboardCard 
          color="bg-brand-green" 
          icon={<Calculator className="text-white" size={24} strokeWidth={1.5} />}
          title="ITCMD" 
          subtitle="Estimativa de imposto"
          onClick={() => setView('itcmd')}
        />
        <DashboardCard 
          color="bg-brand-orange" 
          icon={<CheckSquare className="text-white" size={24} strokeWidth={1.5} />}
          title="Documentos" 
          subtitle="Checklist completo"
          onClick={() => setView('checklist')}
        />
        <DashboardCard 
          color="bg-brand-purple" 
          icon={<MessageSquare className="text-white" size={24} strokeWidth={1.5} />}
          title="IA Jurídica" 
          subtitle="Dúvidas iniciais"
          onClick={() => setView('chat')}
        />
      </div>

      {openHelpModal && (
        <div 
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setOpenHelpModal(false)}
        >
          <div 
            className="bg-white rounded-2xl p-6 shadow-lg max-w-md w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-slate-900">Ajuda e Orientação</h3>
              <button 
                onClick={() => setOpenHelpModal(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            <div className="space-y-6">
              <section>
                <h4 className="font-bold text-slate-800 mb-2 flex items-center gap-2">
                  <span>📌</span> Como usar o app
                </h4>
                <ol className="list-decimal list-inside text-sm text-slate-600 space-y-1">
                  <li>Preencha as informações nas abas disponíveis</li>
                  <li>Revise os dados organizados</li>
                  <li>Gere o relatório para consulta jurídica</li>
                </ol>
              </section>

              <section>
                <h4 className="font-bold text-slate-800 mb-2 flex items-center gap-2">
                  <span>📄</span> O que este app faz
                </h4>
                <p className="text-sm text-slate-600">
                  Organiza informações iniciais de inventário e facilita a comunicação com o advogado.
                </p>
              </section>

              <section>
                <h4 className="font-bold text-slate-800 mb-2 flex items-center gap-2">
                  <span>⚠️</span> O que este app NÃO faz
                </h4>
                <ul className="list-disc list-inside text-sm text-slate-600 space-y-1">
                  <li>Não substitui um advogado</li>
                  <li>Não calcula valores definitivos</li>
                  <li>Não resolve o inventário</li>
                </ul>
              </section>

              <section>
                <h4 className="font-bold text-slate-800 mb-2 flex items-center gap-2">
                  <span>⚖️</span> Quando procurar um advogado
                </h4>
                <ul className="list-disc list-inside text-sm text-slate-600 space-y-1">
                  <li>Conflito entre herdeiros</li>
                  <li>Dúvidas sobre divisão</li>
                  <li>Bens de alto valor</li>
                  <li>Inventário judicial</li>
                </ul>
              </section>

              <section className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                <h4 className="font-bold text-slate-800 mb-2 flex items-center gap-2">
                  <span>📩</span> Contato
                </h4>
                <p className="text-sm text-slate-600 mb-3">Dúvidas ou suporte:</p>
                <button 
                  onClick={() => {
                    window.open(
                      "https://mail.google.com/mail/?view=cm&fs=1&to=Herancanamao@proton.me",
                      "_blank"
                    )
                  }}
                  className="w-full bg-slate-800 text-white py-3 rounded-xl font-medium hover:bg-slate-700 transition-colors flex items-center justify-center gap-2"
                >
                  📩 Enviar e-mail
                </button>
              </section>

              <p className="text-xs text-center text-slate-500 italic">
                Este aplicativo foi criado para te ajudar a dar o primeiro passo com mais clareza e segurança.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DashboardCard({ color, icon, title, subtitle, onClick }: { color: string, icon: React.ReactNode, title: string, subtitle: string, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`${color} rounded-3xl p-7 text-left h-48 flex flex-col justify-between relative overflow-hidden card-shadow transition-all active:scale-95 group`}
    >
      <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-sm group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <div>
        <h4 className="text-white font-bold text-lg leading-tight mb-1">{title}</h4>
        <p className="text-white/70 text-[10px] font-medium uppercase tracking-wider">{subtitle}</p>
      </div>
      <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-white/5 rounded-full blur-2xl" />
    </button>
  );
}

// --- Waitlist Contact Component ---
const WaitlistContactCard = () => {
  const [formData, setFormData] = useState({
    nome: '',
    cidade: '',
    patrimonio: '',
    acordo: ''
  });

  const isFormValid = formData.nome.trim() !== '' && formData.cidade.trim() !== '';

  return (
    <div className="bg-white border border-gray-100 p-5 rounded-2xl card-shadow mt-6">
      <h4 className="text-slate-800 font-bold text-lg mb-2">Entrar na Lista de Espera de Prioridade</h4>
      <p className="text-slate-600 text-sm mb-5">Casos complexos exigem análise cuidadosa. Preencha os dados abaixo para garantir sua vaga na fila de especialistas parceiros.</p>
      
      <div className="space-y-3">
        <input
          type="text"
          placeholder="Nome Completo"
          value={formData.nome}
          onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
          className="w-full p-3 rounded-xl border border-gray-200 bg-gray-50 text-sm outline-none focus:border-blue-400 focus:bg-white transition-colors"
        />
        <input
          type="text"
          placeholder="Cidade/Estado"
          value={formData.cidade}
          onChange={(e) => setFormData({ ...formData, cidade: e.target.value })}
          className="w-full p-3 rounded-xl border border-gray-200 bg-gray-50 text-sm outline-none focus:border-blue-400 focus:bg-white transition-colors"
        />
        <select
          value={formData.patrimonio}
          onChange={(e) => setFormData({ ...formData, patrimonio: e.target.value })}
          className={`w-full p-3 rounded-xl border border-gray-200 bg-gray-50 text-sm outline-none focus:border-blue-400 focus:bg-white transition-colors ${!formData.patrimonio ? 'text-gray-400' : 'text-slate-700'}`}
        >
          <option value="" disabled>Patrimônio Estimado</option>
          <option value="Até R$ 200 mil">Até R$ 200 mil</option>
          <option value="R$ 200 mil a R$ 1 milhão">R$ 200 mil a R$ 1 milhão</option>
          <option value="Acima de R$ 1 milhão">Acima de R$ 1 milhão</option>
        </select>
        <select
          value={formData.acordo}
          onChange={(e) => setFormData({ ...formData, acordo: e.target.value })}
          className={`w-full p-3 rounded-xl border border-gray-200 bg-gray-50 text-sm outline-none focus:border-blue-400 focus:bg-white transition-colors ${!formData.acordo ? 'text-gray-400' : 'text-slate-700'}`}
        >
          <option value="" disabled>Herdeiros estão de acordo?</option>
          <option value="Sim, todos de acordo">Sim, todos de acordo</option>
          <option value="Não, há conflito">Não, há conflito</option>
        </select>
        
        <a 
          href={isFormValid ? `https://api.whatsapp.com/send?phone=5516988133906&text=${encodeURIComponent(`📋 NOVA SOLICITAÇÃO - LISTA DE ESPERA\n👤 Nome: ${formData.nome}\n📍 Cidade: ${formData.cidade}\n💰 Patrimônio: ${formData.patrimonio || 'Não informado'}\n🤝 Acordo: ${formData.acordo || 'Não informado'}\n🔴 Status: Alta Complexidade`)}` : '#'}
          target="_blank"
          rel="noopener noreferrer"
          className={`w-full mt-2 bg-[#25D366] text-white p-5 rounded-2xl shadow-lg flex items-center justify-center gap-3 transition-all font-black text-base ${!isFormValid ? 'opacity-40 grayscale cursor-not-allowed pointer-events-none' : 'hover:bg-[#1da851]'}`}
          style={{ textDecoration: 'none' }}
        >
          <CheckCircle2 className="w-6 h-6" />
          GARANTIR MINHA VAGA
        </a>
      </div>
    </div>
  );
};

// --- Heirs Flow View ---
function HeirsFlow({ state, setState, step, setStep, onBack }: { state: HeirState, setState: React.Dispatch<React.SetStateAction<HeirState>>, step: number, setStep: React.Dispatch<React.SetStateAction<number>>, onBack: () => void }) {
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Activation State
  const [showModal, setShowModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [activationCode, setActivationCode] = useState('');
  const [activationError, setActivationError] = useState<string | null>(null);
  const [isActivated, setIsActivated] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [showToast, setShowToast] = useState(false);

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatHNMCode(e.target.value);
    setActivationCode(formatted);
    if (formatted.length === 12) {
      if (validateHNM(formatted)) {
        setActivationError("Código validado!");
      } else {
        setActivationError("Código inválido. Verifique os números digitados.");
      }
    } else {
      setActivationError(null);
    }
  };

  const getBorderColor = () => {
    if (activationError === "Código validado!") return 'border-green-500 ring-2 ring-green-500/20';
    if (activationError) return 'border-red-500 ring-2 ring-red-500/20';
    if (activationCode.length === 0) return 'border-slate-100';
    if (activationCode.length < 12) return 'border-blue-500 ring-2 ring-blue-500/20';
    if (validateHNM(activationCode)) return 'border-green-500 ring-2 ring-green-500/20';
    return 'border-red-500 ring-2 ring-red-500/20';
  };

  const handleAnswer = (key: keyof HeirState, value: any) => {
    setState(prev => ({ ...prev, [key]: value }));
    setStep(prev => prev + 1);
  };

  const generateHeirsPDF = async (force?: boolean | React.MouseEvent) => {
    if (isGenerating) return;
    setIsGenerating(true);

    try {
      const isForced = force === true;
      if (!isActivated && !isForced) {
        setShowModal(true);
        return;
      }
      const doc = new jsPDF();
      const protocol = generateProtocol();
      
      addStandardCover(doc, 'Estrutura de Herdeiros', protocol);
      
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(0);
      doc.text('Estrutura de Herdeiros', 20, 30);
      doc.line(20, 35, 190, 35);
      
      let currentY = 50;
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(12);
      
      const { label } = getComplexityInfo(state, step);
      
      const heirsData = [
        ['Situação Conjugal', state.married ? 'Casado / União Estável' : 'Solteiro / Outro'],
        ['Regime de Bens', state.regime || 'N/A'],
        ['Existência de Descendentes', state.hasChildren ? 'Sim' : 'Não'],
        ['Existência de Ascendentes', state.hasParents ? 'Sim' : 'Não'],
        ['Resultado Final da Triagem', label]
      ];
      
      autoTable(doc, {
        startY: currentY,
        head: [['Campo', 'Informação']],
        body: heirsData,
        theme: 'grid',
        headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
        styles: { fontSize: 10, cellPadding: 5 }
      });

      addStandardFooter(doc);
      doc.save(`Herdeiros_${protocol}.pdf`);
      setIsActivated(false);
    } catch (error) {
      console.error('Erro ao gerar PDF:', error);
      alert('Ocorreu um erro ao gerar o PDF. Por favor, tente novamente.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleActivate = async () => {
    const code = activationCode.trim().toUpperCase();
    if (isValidating) return;
    
    if (!validateHNM(code)) {
      setActivationError("Código inválido. Verifique os números digitados.");
      return;
    }
    
    setIsValidating(true);
    setActivationError(null);

    try {
      const response = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      const result = await response.json();

      if (result.valid) {
        setIsActivated(true);
        setShowModal(false);
        setShowToast(true);
        setTimeout(() => {
          setShowToast(false);
          setShowSuccessModal(true);
        }, 3000);
      } else {
        setActivationError(result.message || "Código já utilizado ou inválido");
      }
    } catch (err) {
      console.error('Validation error:', err);
      setActivationError("Erro na comunicação com o servidor.");
    } finally {
      setIsValidating(false);
    }
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setActivationCode('');
    setActivationError(null);
  };

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <QuestionStep 
            title="O falecido era casado ou vivia em união estável?"
            options={[
              { label: 'Sim', value: true },
              { label: 'Não', value: false }
            ]}
            onSelect={(v) => {
              if (v === false) {
                setState(prev => ({ ...prev, married: false, regime: 'Nenhum' }));
                setStep(2); // Skip regime
              } else {
                handleAnswer('married', true);
              }
            }}
          />
        );
      case 1:
        return (
          <QuestionStep 
            title="Qual era o regime de bens do casal?"
            options={[
              { label: 'Comunhão Parcial', value: 'parcial' },
              { label: 'Comunhão Universal', value: 'universal' },
              { label: 'Separação Total', value: 'separacao' },
              { label: 'Não sei informar', value: 'desconhecido' }
            ]}
            onSelect={(v) => handleAnswer('regime', v)}
          />
        );
      case 2:
        return (
          <QuestionStep 
            title="O falecido deixou filhos ou descendentes?"
            options={[
              { label: 'Sim', value: true },
              { label: 'Não', value: false }
            ]}
            onSelect={(v) => {
              if (v === true) {
                handleAnswer('hasChildren', true);
              } else {
                setState(prev => ({ ...prev, hasChildren: false }));
                setStep(3); // Go to parents question
              }
            }}
          />
        );
      case 3:
        return (
          <QuestionStep 
            title="O falecido deixou pais ou avós vivos (ascendentes)?"
            options={[
              { label: 'Sim', value: true },
              { label: 'Não', value: false }
            ]}
            onSelect={(v) => handleAnswer('hasParents', v)}
          />
        );
      default:
        const { level, label, recommendation } = getComplexityInfo(state, step);
        
        const styleMap = {
          green: {
            bg: 'bg-green-50',
            border: 'border-green-400',
            text: 'text-green-700',
            indicator: 'bg-green-500'
          },
          yellow: {
            bg: 'bg-yellow-50',
            border: 'border-yellow-400',
            text: 'text-yellow-700',
            indicator: 'bg-yellow-500'
          },
          red: {
            bg: 'bg-red-50',
            border: 'border-red-400',
            text: 'text-red-700',
            indicator: 'bg-red-500'
          },
          gray: {
            bg: 'bg-gray-50',
            border: 'border-gray-300',
            text: 'text-gray-700',
            indicator: 'bg-gray-400'
          }
        };

        const currentStyle = styleMap[level];

        return (
          <div className="space-y-6 py-4">
            <div className="text-center">
              <Users size={48} className="mx-auto text-brand-blue mb-4 opacity-20" />
              <h3 className="text-xl font-bold mb-1">Triage de Estrutura Sucessória</h3>
              <p className="text-text-muted text-xs">Resumo organizacional para consulta jurídica</p>
            </div>

            <div className="bg-white p-5 rounded-2xl card-shadow border border-gray-50 space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted border-b border-gray-50 pb-2">Resumo das Informações</h4>
              <div className="grid gap-3">
                <SummaryItem label="Estado Civil" value={state.married ? 'Casado / União Estável' : 'Solteiro / Outro'} />
                {state.married && <SummaryItem label="Regime de Bens" value={state.regime === 'parcial' ? 'Comunhão Parcial' : state.regime === 'universal' ? 'Comunhão Universal' : state.regime === 'separacao' ? 'Separação Total' : 'Desconhecido'} />}
                <SummaryItem label="Descendentes" value={state.hasChildren ? 'Sim' : 'Não'} />
                {!state.hasChildren && <SummaryItem label="Ascendentes" value={state.hasParents ? 'Sim' : 'Não'} />}
              </div>
            </div>

            <div className={`p-5 rounded-xl shadow-sm border-l-4 ${currentStyle.bg} ${currentStyle.border}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-3 h-3 rounded-full ${currentStyle.indicator}`} />
                <h3 className={`font-bold ${currentStyle.text}`}>Nível de Complexidade</h3>
              </div>
              <p className="font-semibold text-slate-800 mb-1">
                {label}
              </p>
              <p className="text-sm text-gray-600 leading-relaxed">
                {recommendation}
              </p>
              <p className="text-[10px] text-gray-500 mt-4 italic">
                *Classificação organizacional baseada em regras gerais. Pode variar conforme o caso concreto.
              </p>
            </div>

            {level === 'red' && <WaitlistContactCard />}

            {/* PDF Download Button */}
            <div className="pt-4">
              <button
                onClick={generateHeirsPDF}
                disabled={isGenerating}
                className="w-full bg-[#F97316] text-white p-6 rounded-3xl shadow-lg shadow-orange-100 flex flex-col items-center justify-center gap-1 hover:scale-[1.02] active:scale-[0.98] transition-all duration-150 group disabled:opacity-70"
              >
                <div className="flex items-center gap-2">
                  {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                    isActivated ? <Download className="w-5 h-5 group-hover:translate-y-0.5 transition-transform" /> : <Lock className="w-5 h-5" />
                  )}
                  <span className="font-bold text-base">
                    {isGenerating ? 'Gerando relatório...' : (isActivated ? 'Baixar Relatório Profissional em PDF' : 'Liberar Relatório Profissional')}
                  </span>
                </div>
                <span className="text-[10px] text-white/80 font-medium">
                  {isActivated ? 'Documento estruturado para apresentação ao advogado' : 'Exige código de ativação para download'}
                </span>
              </button>
            </div>

            <button 
              onClick={() => { setStep(0); setState(INITIAL_HEIR_STATE); }}
              className="bg-brand-blue text-white w-full py-4 rounded-xl font-bold shadow-lg shadow-blue-100"
            >
              Iniciar Nova Triage
            </button>

            {/* Toast Notification */}
            <AnimatePresence>
              {showToast && (
                <motion.div 
                  initial={{ opacity: 0, y: 50 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 50 }}
                  className="fixed bottom-24 left-6 right-6 z-[60] bg-slate-900 text-white p-4 rounded-2xl shadow-2xl flex items-center gap-3 border border-white/10"
                >
                  <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center shrink-0">
                    <CheckCircle2 size={18} />
                  </div>
                  <p className="text-sm font-bold">Acesso Liberado! Gerando seu PDF...</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Activation Modal */}
            <AnimatePresence>
              {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={handleCloseModal}
                    className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
                  />
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.9, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 20 }}
                    className="relative w-full max-w-sm bg-white rounded-[2rem] p-8 shadow-2xl space-y-6"
                  >
                    <div className="text-center space-y-2">
                      <div className="w-16 h-16 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <Lock size={32} />
                      </div>
                      <h3 className="text-xl font-black text-slate-900 tracking-tight">Ativação Necessária</h3>
                      <p className="text-sm text-slate-500 font-medium">Insira seu código de acesso para liberar o download do relatório profissional.</p>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-1">Código de Ativação</label>
                        <input 
                          type="text"
                          placeholder="HNM-XXXXXX-D"
                          value={activationCode}
                          onChange={handleCodeChange}
                          className={`w-full p-4 bg-slate-50 border rounded-2xl outline-none font-mono text-center text-lg tracking-widest text-slate-700 placeholder:text-slate-300 transition-all uppercase ${getBorderColor()}`}
                        />
                      </div>

                      {activationError && (
                        <motion.p 
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={`text-xs font-bold text-center p-3 rounded-xl border ${
                            activationError === "Código validado!" 
                              ? "text-[#28A745] bg-green-50 border-green-100" 
                              : "text-red-500 bg-red-50 border-red-100"
                          }`}
                        >
                          {activationError}
                        </motion.p>
                      )}

                      <button 
                        onClick={handleActivate}
                        disabled={isValidating || activationCode.length < 12}
                        className={`w-full py-5 rounded-2xl font-bold shadow-lg transition-all flex items-center justify-center gap-2 ${
                          activationCode.length === 12
                            ? validateHNM(activationCode)
                              ? 'bg-[#FF8C00] text-white shadow-orange-200 hover:bg-[#E67E00] active:scale-[0.98] pointer-events-auto opacity-100'
                              : 'bg-red-500 text-white shadow-red-200 hover:bg-red-600 active:scale-[0.98] pointer-events-auto opacity-100'
                            : 'bg-slate-300 text-slate-500 shadow-none cursor-not-allowed pointer-events-none opacity-50'
                        }`}
                      >
                        {isValidating ? <Loader2 className="w-5 h-5 animate-spin" /> : '🔓 Ativar Código e Liberar PDF'}
                      </button>

                      <button 
                        onClick={handleCloseModal}
                        className="w-full py-2 text-slate-400 text-[10px] font-bold uppercase tracking-widest hover:text-slate-600 transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

            {/* Success Modal */}
            <AnimatePresence>
              {showSuccessModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setShowSuccessModal(false)}
                    className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
                  />
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                    className="relative w-full max-w-sm bg-white rounded-[2rem] p-8 shadow-2xl text-center space-y-6"
                  >
                    <div className="space-y-4">
                      <motion.div 
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                        className="w-20 h-20 bg-green-100 text-green-600 rounded-3xl flex items-center justify-center mx-auto"
                      >
                        <motion.div
                          animate={{ scale: [1, 1.1, 1] }}
                          transition={{ delay: 0.5, duration: 0.5 }}
                        >
                          <Unlock size={40} />
                        </motion.div>
                      </motion.div>
                      
                      <div className="space-y-2">
                        <h3 className="text-xl font-black text-slate-900 tracking-tight">Relatório Desbloqueado</h3>
                        <p className="text-sm text-slate-500 font-medium px-4">Seu acesso profissional foi liberado com sucesso.</p>
                      </div>
                    </div>

                    <div className="pt-2">
                      <button 
                        onClick={() => {
                          setShowSuccessModal(false);
                          generateHeirsPDF();
                        }}
                        className="w-full bg-green-600 text-white py-5 rounded-2xl font-bold shadow-lg shadow-green-100 hover:bg-green-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                      >
                        <Download size={20} />
                        Baixar Relatório Agora
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </div>
        );
    }
  };

  return (
    <div className="p-6">
      <header className="flex items-center gap-4 mb-8">
        <button onClick={onBack} className="p-2 -ml-2"><ArrowLeft size={24} /></button>
        <h1 className="text-lg font-bold">Quem são os Herdeiros?</h1>
      </header>
      
      <Disclaimer />

      <ComplexityIndicator state={state} step={step} />

      <div className="mb-6">
        <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
          <div 
            className="h-full bg-brand-blue transition-all duration-500" 
            style={{ width: `${((step + 1) / 4) * 100}%` }}
          />
        </div>
        <p className="text-[10px] text-text-muted mt-2 uppercase font-bold tracking-wider">Passo {step + 1} de 4</p>
      </div>

      {renderStep()}
    </div>
  );
}

function SummaryItem({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-xs font-bold text-text-main">{value}</span>
    </div>
  );
}

function QuestionStep({ title, options, onSelect }: { title: string, options: { label: string, value: any }[], onSelect: (v: any) => void }) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <h2 className="text-2xl font-extrabold text-slate-900 leading-tight tracking-tight">{title}</h2>
      <div className="grid gap-3">
        {options.map((opt, i) => (
          <button
            key={i}
            onClick={() => onSelect(opt.value)}
            className="w-full p-6 text-left bg-white border border-slate-100 rounded-3xl font-semibold text-slate-700 card-shadow hover:border-brand-blue/30 transition-all flex justify-between items-center group"
          >
            {opt.label}
            <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center group-hover:bg-brand-blue/10 group-hover:text-brand-blue transition-colors">
              <ChevronRight size={18} />
            </div>
          </button>
        ))}
      </div>
    </motion.div>
  );
}

// --- ITCMD Calculator View ---
interface ITCMDProps {
  state: string;
  setState: (v: string) => void;
  value: string;
  setValue: (v: string) => void;
  result: number | null;
  setResult: (v: number | null) => void;
  onBack: () => void;
}

function ITCMDCalculator({ state, setState, value, setValue, result, setResult, onBack }: ITCMDProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  
  const estadosBrasil = [
    { sigla: "AC", nome: "Acre" },
    { sigla: "AL", nome: "Alagoas" },
    { sigla: "AP", nome: "Amapá" },
    { sigla: "AM", nome: "Amazonas" },
    { sigla: "BA", nome: "Bahia" },
    { sigla: "CE", nome: "Ceará" },
    { sigla: "DF", nome: "Distrito Federal" },
    { sigla: "ES", nome: "Espírito Santo" },
    { sigla: "GO", nome: "Goiás" },
    { sigla: "MA", nome: "Maranhão" },
    { sigla: "MT", nome: "Mato Grosso" },
    { sigla: "MS", nome: "Mato Grosso do Sul" },
    { sigla: "MG", nome: "Minas Gerais" },
    { sigla: "PA", nome: "Pará" },
    { sigla: "PB", nome: "Paraíba" },
    { sigla: "PR", nome: "Paraná" },
    { sigla: "PE", nome: "Pernambuco" },
    { sigla: "PI", nome: "Piauí" },
    { sigla: "RJ", nome: "Rio de Janeiro" },
    { sigla: "RN", nome: "Rio Grande do Norte" },
    { sigla: "RS", nome: "Rio Grande do Sul" },
    { sigla: "RO", nome: "Rondônia" },
    { sigla: "RR", nome: "Roraima" },
    { sigla: "SC", nome: "Santa Catarina" },
    { sigla: "SP", nome: "São Paulo" },
    { sigla: "SE", nome: "Sergipe" },
    { sigla: "TO", nome: "Tocantins" }
  ];

  // Activation State
  const [showModal, setShowModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [activationCode, setActivationCode] = useState('');
  const [activationError, setActivationError] = useState<string | null>(null);
  const [isActivated, setIsActivated] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [showToast, setShowToast] = useState(false);

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatHNMCode(e.target.value);
    setActivationCode(formatted);
    if (formatted.length === 12) {
      if (validateHNM(formatted)) {
        setActivationError("Código validado!");
      } else {
        setActivationError("Código inválido. Verifique os números digitados.");
      }
    } else {
      setActivationError(null);
    }
  };

  const getBorderColor = () => {
    if (activationError === "Código validado!") return 'border-green-500 ring-2 ring-green-500/20';
    if (activationError) return 'border-red-500 ring-2 ring-red-500/20';
    if (activationCode.length === 0) return 'border-slate-100';
    if (activationCode.length < 12) return 'border-blue-500 ring-2 ring-blue-500/20';
    if (validateHNM(activationCode)) return 'border-green-500 ring-2 ring-green-500/20';
    return 'border-red-500 ring-2 ring-red-500/20';
  };

  const formatCurrency = (val: string) => {
    const digits = val.replace(/\D/g, '');
    if (!digits) return '';
    const amount = parseInt(digits, 10) / 100;
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(amount);
  };

  const calculate = () => {
    const rate = ITCMD_RATES[state] || 4;
    const val = parseFloat(value.replace(/\D/g, '')) / 100;
    if (!isNaN(val)) {
      setResult(val * (rate / 100));
    }
  };

  const generateITCMDPDF = async (force?: boolean | React.MouseEvent) => {
    if (isGenerating) return;
    setIsGenerating(true);

    try {
      const isForced = force === true;
      if (!isActivated && !isForced) {
        setShowModal(true);
        return;
      }
      const doc = new jsPDF();
      const protocol = generateProtocol();
      
      addStandardCover(doc, 'Estimativa de ITCMD', protocol);
      
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(0);
      doc.text('Estimativa de ITCMD', 20, 30);
      doc.line(20, 35, 190, 35);
      
      let currentY = 50;
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(12);
      
      const itcmdData = [
        ['Estado Selecionado', state],
        ['Valor Informado', value],
        ['Alíquota Aplicada', `${ITCMD_RATES[state]}%`],
        ['Valor Estimado Calculado', result?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) || 'R$ 0,00']
      ];
      
      autoTable(doc, {
        startY: currentY,
        head: [['Campo', 'Informação']],
        body: itcmdData,
        theme: 'grid',
        headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
        styles: { fontSize: 10, cellPadding: 5 }
      });

      addStandardFooter(doc);
      doc.save(`ITCMD_${protocol}.pdf`);
      setIsActivated(false);
    } catch (error) {
      console.error('Erro ao gerar PDF:', error);
      alert('Ocorreu um erro ao gerar o PDF. Por favor, tente novamente.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleActivate = async () => {
    const code = activationCode.trim().toUpperCase();
    if (isValidating) return;
    
    if (!validateHNM(code)) {
      setActivationError("Código inválido. Verifique os números digitados.");
      return;
    }
    
    setIsValidating(true);
    setActivationError(null);

    try {
      const response = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      const result = await response.json();

      if (result.valid) {
        setIsActivated(true);
        setShowModal(false);
        setShowToast(true);
        setTimeout(() => {
          setShowToast(false);
          setShowSuccessModal(true);
        }, 3000);
      } else {
        setActivationError(result.message || "Código já utilizado ou inválido");
      }
    } catch (err) {
      console.error('Validation error:', err);
      setActivationError("Erro na comunicação com o servidor.");
    } finally {
      setIsValidating(false);
    }
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setActivationCode('');
    setActivationError(null);
  };

  return (
    <div className="p-6">
      <header className="flex items-center gap-4 mb-8">
        <button onClick={onBack} className="p-2 -ml-2"><ArrowLeft size={24} /></button>
        <h1 className="text-lg font-bold">Estimativa Simplificada de ITCMD</h1>
      </header>

      <Disclaimer />

      <div className="space-y-8">
        <div className="bg-white p-6 rounded-3xl card-shadow border border-slate-50 space-y-6">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Estado (UF)</label>
            <select 
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-brand-green/20 font-semibold text-slate-700 transition-all"
            >
              {estadosBrasil.map(estado => (
                <option key={estado.sigla} value={estado.sigla}>{estado.sigla} – {estado.nome}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Valor Total dos Bens (Estimado)</label>
            <div className="flex gap-2">
              <input 
                type="text"
                placeholder="R$ 0,00"
                value={value}
                onChange={(e) => setValue(formatCurrency(e.target.value))}
                className="flex-1 p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-brand-green/20 font-bold text-slate-700 placeholder:text-slate-300 transition-all"
              />
              <button 
                onClick={() => { setValue(''); setResult(null); }}
                className="w-14 h-14 flex items-center justify-center bg-white border border-slate-100 rounded-2xl text-slate-400 hover:text-brand-orange hover:border-brand-orange/20 transition-all card-shadow"
                title="Limpar e novo cálculo"
              >
                <RotateCcw size={20} />
              </button>
            </div>
          </div>

          <button 
            onClick={calculate}
            className="w-full bg-brand-green text-white py-5 rounded-2xl font-bold shadow-lg shadow-green-100 hover:bg-brand-green/90 active:scale-[0.98] transition-all"
          >
            Gerar Estimativa Simplificada
          </button>
        </div>

        {result !== null && (
          <div className="space-y-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-emerald-50/50 border border-emerald-100 p-8 rounded-3xl text-center space-y-4"
            >
              <div className="inline-block px-3 py-1 bg-emerald-100 rounded-full text-[10px] font-bold text-emerald-700 uppercase tracking-widest mb-2">
                Resultado da Estimativa
              </div>
              <p className="text-emerald-900/60 text-[10px] font-bold uppercase leading-tight max-w-[200px] mx-auto">
                Valor estimado com base em alíquota média estadual.
              </p>
              <h3 className="text-4xl font-black text-emerald-900 tracking-tight">
                {result.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </h3>
              <div className="pt-4 border-t border-emerald-100/50">
                <p className="text-[10px] text-emerald-700/70 leading-relaxed italic font-medium">
                  *Alíquota aplicada: {ITCMD_RATES[state]}%. Esta é uma base organizacional que pode variar conforme o caso, isenções ou multas.
                </p>
              </div>
            </motion.div>

            {/* PDF Download Button */}
            <div className="pt-4 pb-10">
              <button
                onClick={generateITCMDPDF}
                disabled={isGenerating}
                className="w-full bg-[#F97316] text-white p-6 rounded-3xl shadow-lg shadow-orange-100 flex flex-col items-center justify-center gap-1 hover:scale-[1.02] active:scale-[0.98] transition-all duration-150 group disabled:opacity-70"
              >
                <div className="flex items-center gap-2">
                  {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                    isActivated ? <Download className="w-5 h-5 group-hover:translate-y-0.5 transition-transform" /> : <Lock className="w-5 h-5" />
                  )}
                  <span className="font-bold text-base">
                    {isGenerating ? 'Gerando relatório...' : (isActivated ? 'Baixar Relatório Profissional em PDF' : 'Liberar Relatório Profissional')}
                  </span>
                </div>
                <span className="text-[10px] text-white/80 font-medium">
                  {isActivated ? 'Documento estruturado para apresentação ao advogado' : 'Exige código de ativação para download'}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Activation Modal */}
        <AnimatePresence>
          {showModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={handleCloseModal}
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="relative w-full max-w-sm bg-white rounded-[2rem] p-8 shadow-2xl space-y-6"
              >
                <div className="text-center space-y-2">
                  <div className="w-16 h-16 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Lock size={32} />
                  </div>
                  <h3 className="text-xl font-black text-slate-900 tracking-tight">Ativação Necessária</h3>
                  <p className="text-sm text-slate-500 font-medium">Insira seu código de acesso para liberar o download do relatório profissional.</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-1">Código de Ativação</label>
                    <input 
                      type="text"
                      placeholder="HNM-XXXXXX-D"
                      value={activationCode}
                      onChange={handleCodeChange}
                      className={`w-full p-4 bg-slate-50 border rounded-2xl outline-none font-mono text-center text-lg tracking-widest text-slate-700 placeholder:text-slate-300 transition-all uppercase ${getBorderColor()}`}
                    />
                  </div>

                  {activationError && (
                    <motion.p 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`text-xs font-bold text-center p-3 rounded-xl border ${
                        activationError === "Código validado!" 
                          ? "text-[#28A745] bg-green-50 border-green-100" 
                          : "text-red-500 bg-red-50 border-red-100"
                      }`}
                    >
                      {activationError}
                    </motion.p>
                  )}

                  <button 
                    onClick={handleActivate}
                    disabled={isValidating || activationCode.length < 12}
                    className={`w-full py-5 rounded-2xl font-bold shadow-lg transition-all flex items-center justify-center gap-2 ${
                      activationCode.length === 12
                        ? validateHNM(activationCode)
                          ? 'bg-[#FF8C00] text-white shadow-orange-200 hover:bg-[#E67E00] active:scale-[0.98] pointer-events-auto opacity-100'
                          : 'bg-red-500 text-white shadow-red-200 hover:bg-red-600 active:scale-[0.98] pointer-events-auto opacity-100'
                        : 'bg-slate-300 text-slate-500 shadow-none cursor-not-allowed pointer-events-none opacity-50'
                    }`}
                  >
                    {isValidating ? <Loader2 className="w-5 h-5 animate-spin" /> : '🔓 Ativar Código e Liberar PDF'}
                  </button>

                  <button 
                    onClick={handleCloseModal}
                    className="w-full py-2 text-slate-400 text-[10px] font-bold uppercase tracking-widest hover:text-slate-600 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Success Modal */}
        <AnimatePresence>
          {showSuccessModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowSuccessModal(false)}
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="relative w-full max-w-sm bg-white rounded-[2rem] p-8 shadow-2xl text-center space-y-6"
              >
                <div className="space-y-4">
                  <motion.div 
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                    className="w-20 h-20 bg-green-100 text-green-600 rounded-3xl flex items-center justify-center mx-auto"
                  >
                    <motion.div
                      animate={{ scale: [1, 1.1, 1] }}
                      transition={{ delay: 0.5, duration: 0.5 }}
                    >
                      <Unlock size={40} />
                    </motion.div>
                  </motion.div>
                  
                  <div className="space-y-2">
                    <h3 className="text-xl font-black text-slate-900 tracking-tight">Relatório Desbloqueado</h3>
                    <p className="text-sm text-slate-500 font-medium px-4">Seu acesso profissional foi liberado com sucesso.</p>
                  </div>
                </div>

                <div className="pt-2">
                  <button 
                    onClick={() => {
                      setShowSuccessModal(false);
                      generateITCMDPDF();
                    }}
                    className="w-full bg-green-600 text-white py-5 rounded-2xl font-bold shadow-lg shadow-green-100 hover:bg-green-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                  >
                    <Download size={20} />
                    Baixar Relatório Agora
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Toast Notification */}
        <AnimatePresence>
          {showToast && (
            <motion.div 
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              className="fixed bottom-24 left-6 right-6 z-[60] bg-slate-900 text-white p-4 rounded-2xl shadow-2xl flex items-center gap-3 border border-white/10"
            >
              <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center shrink-0">
                <CheckCircle2 size={18} />
              </div>
              <p className="text-sm font-bold">Acesso Liberado! Gerando seu PDF...</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// --- Checklist View ---
interface ChecklistProps {
  heirState: HeirState;
  heirStep: number;
  itcmdResult: number | null;
  itcmdUF: string;
  onBack: () => void;
}

function Checklist({ heirState, heirStep, itcmdResult, itcmdUF, onBack }: ChecklistProps) {
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [checked, setChecked] = useState<string[]>([]);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Activation State
  const [showModal, setShowModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [activationCode, setActivationCode] = useState('');
  const [activationError, setActivationError] = useState<string | null>(null);
  const [isActivated, setIsActivated] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [showToast, setShowToast] = useState(false);

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatHNMCode(e.target.value);
    setActivationCode(formatted);
    if (formatted.length === 12) {
      if (validateHNM(formatted)) {
        setActivationError("Código validado!");
      } else {
        setActivationError("Código inválido. Verifique os números digitados.");
      }
    } else {
      setActivationError(null);
    }
  };

  const getBorderColor = () => {
    if (activationError === "Código validado!") return 'border-green-500 ring-2 ring-green-500/20';
    if (activationError) return 'border-red-500 ring-2 ring-red-500/20';
    if (activationCode.length === 0) return 'border-slate-100';
    if (activationCode.length < 12) return 'border-blue-500 ring-2 ring-blue-500/20';
    if (validateHNM(activationCode)) return 'border-green-500 ring-2 ring-green-500/20';
    return 'border-red-500 ring-2 ring-red-500/20';
  };

  const updateTimestamp = () => {
    const now = new Date();
    setLastUpdate(now.toLocaleString('pt-BR', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    }));
  };

  const toggleAsset = (id: string) => {
    setSelectedAssets(prev => 
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );
    updateTimestamp();
  };

  const toggleDoc = (id: string) => {
    setChecked(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
    updateTimestamp();
  };

  const activeDocuments = [
    ...DYNAMIC_DOCUMENTS.geral,
    ...selectedAssets.flatMap(assetId => DYNAMIC_DOCUMENTS[assetId] || [])
  ];

  const markAll = () => {
    if (checked.length === activeDocuments.length) {
      setChecked([]);
    } else {
      setChecked(activeDocuments.map(d => d.id));
    }
    updateTimestamp();
  };

  const assetDocsCount = selectedAssets.reduce((acc, assetId) => acc + (DYNAMIC_DOCUMENTS[assetId]?.length || 0), 0);
  
  const progress = activeDocuments.length > 0 
    ? Math.round((checked.length / activeDocuments.length) * 100) 
    : 0;

  const generatePDF = async (force?: boolean | React.MouseEvent) => {
    if (isGenerating) return;
    setIsGenerating(true);

    try {
      const isForced = force === true;
      if (!isActivated && !isForced) {
        setShowModal(true);
        return;
      }
      const doc = new jsPDF();
      const protocol = generateProtocol();
      
      addStandardCover(doc, 'Checklist de Documentos', protocol);
      
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(0);
      doc.text('Checklist de Documentos', 20, 30);
      doc.line(20, 35, 190, 35);
      
      let currentY = 50;

      // --- Estrutura de Herdeiros ---
      if (heirStep > 0) {
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('1. Estrutura de Herdeiros', 20, currentY);
        currentY += 10;
        
        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        const { label } = getComplexityInfo(heirState, heirStep);
        
        const heirData = [
          ['Estado Civil', heirState.married ? 'Casado / União Estável' : 'Solteiro / Outro'],
          ['Regime de Bens', heirState.regime || 'N/A'],
          ['Descendentes', heirState.hasChildren ? 'Sim' : 'Não'],
          ['Ascendentes', heirState.hasParents ? 'Sim' : 'Não'],
          ['Classificação', label]
        ];
        
        autoTable(doc, {
          startY: currentY,
          head: [['Campo', 'Informação']],
          body: heirData,
          theme: 'grid',
          headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
          styles: { fontSize: 10, cellPadding: 5 }
        });
        
        currentY = (doc as any).lastAutoTable.finalY + 15;
      }

      // --- Estimativa de ITCMD ---
      if (itcmdResult !== null) {
        if (currentY > 250) { doc.addPage(); currentY = 30; }
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('2. Estimativa de ITCMD', 20, currentY);
        currentY += 10;
        
        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        doc.text(`Estado (UF): ${itcmdUF}`, 20, currentY);
        currentY += 7;
        doc.text(`Valor Estimado: ${itcmdResult.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, 20, currentY);
        currentY += 15;
      }

      // --- Checklist de Documentos ---
      if (currentY > 250) { doc.addPage(); currentY = 30; }
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('3. Checklist de Documentos', 20, currentY);
      currentY += 10;

      const categories = Object.keys(DYNAMIC_DOCUMENTS).filter(key => key === 'geral' || selectedAssets.includes(key));
      
      categories.forEach((catKey) => {
        const catLabel = catKey === 'geral' ? 'Documentos Gerais' : ASSET_TYPES.find(a => a.id === catKey)?.label || catKey;
        const docs = DYNAMIC_DOCUMENTS[catKey];
        
        autoTable(doc, {
          startY: currentY,
          head: [[catLabel, 'Status']],
          body: docs.map(d => [d.label, checked.includes(d.id) ? '[X] Concluído' : '[ ] Pendente']),
          theme: 'plain',
          headStyles: { fontStyle: 'bold', fontSize: 10, textColor: [0, 0, 0] },
          styles: { fontSize: 10, cellPadding: 3 },
          margin: { left: 20 }
        });
        
        currentY = (doc as any).lastAutoTable.finalY + 10;
        if (currentY > 270) { doc.addPage(); currentY = 30; }
      });

      addStandardFooter(doc);
      doc.save(`Relatorio_Inventario_${protocol}.pdf`);
      setIsActivated(false);
    } catch (error) {
      console.error('Erro ao gerar PDF:', error);
      alert('Ocorreu um erro ao gerar o PDF. Por favor, tente novamente.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleActivate = async () => {
    const code = activationCode.trim().toUpperCase();
    if (isValidating) return;
    
    if (!validateHNM(code)) {
      setActivationError("Código inválido. Verifique os números digitados.");
      return;
    }
    
    setIsValidating(true);
    setActivationError(null);

    try {
      const response = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      const result = await response.json();

      if (result.valid) {
        setIsActivated(true);
        setShowModal(false);
        setShowToast(true);
        setTimeout(() => {
          setShowToast(false);
          setShowSuccessModal(true);
        }, 3000);
      } else {
        setActivationError(result.message || "Código já utilizado ou inválido");
      }
    } catch (err) {
      console.error('Validation error:', err);
      setActivationError("Erro na comunicação com o servidor.");
    } finally {
      setIsValidating(false);
    }
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setActivationCode('');
    setActivationError(null);
  };

  return (
    <div className="p-6">
      <header className="flex items-center gap-4 mb-8">
        <button onClick={onBack} className="p-2 -ml-2"><ArrowLeft size={24} /></button>
        <h1 className="text-lg font-bold">Checklist Documentos</h1>
      </header>

      <Disclaimer />

      <div className="space-y-8">
        {/* Asset Selection */}
        <div className="bg-white p-6 rounded-3xl card-shadow border border-slate-50">
          <h2 className="text-lg font-extrabold text-slate-900 tracking-tight mb-1">
            Quais tipos de bens existem no patrimônio?
          </h2>
          <p className="text-slate-500 text-xs font-medium mb-6">
            Selecione para gerar uma lista personalizada de documentos.
          </p>
          
          <div className="flex flex-wrap gap-2 mb-8">
            {ASSET_TYPES.map(asset => (
              <button
                key={asset.id}
                onClick={() => toggleAsset(asset.id)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
                  selectedAssets.includes(asset.id)
                    ? 'bg-brand-blue border-brand-blue text-white shadow-md shadow-blue-100'
                    : 'bg-slate-50 border-slate-100 text-slate-500 hover:bg-slate-100'
                }`}
              >
                {asset.label}
              </button>
            ))}
          </div>

          <button 
            disabled={selectedAssets.length === 0}
            onClick={() => {
              document.getElementById('document-list')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className={`w-full py-4 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
              selectedAssets.length === 0
                ? 'bg-slate-900/60 text-white/90 shadow-none cursor-not-allowed'
                : 'bg-slate-900 text-white shadow-lg shadow-slate-200 active:scale-[0.98]'
            }`}
          >
            {selectedAssets.length === 0 
              ? 'Selecione os bens acima' 
              : `Ver documentos selecionados (${assetDocsCount})`}
          </button>
        </div>

        {/* Progress and Actions */}
        {activeDocuments.length > 0 && (
          <div className="bg-white p-5 rounded-2xl card-shadow border border-gray-50">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs font-bold text-text-main">Progresso Geral</p>
                <p className="text-[10px] text-text-muted uppercase tracking-wider">{checked.length} de {activeDocuments.length} itens</p>
              </div>
              <span className="text-xl font-black text-brand-orange">{progress}%</span>
            </div>
            
            <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden mb-4">
              <div 
                className="h-full bg-brand-orange transition-all duration-500 ease-out" 
                style={{ width: `${progress}%` }} 
              />
            </div>

            <div className="flex justify-between items-center">
              <button 
                onClick={markAll}
                className="text-[10px] font-bold text-brand-orange uppercase tracking-widest hover:opacity-70 transition-opacity"
              >
                {checked.length === activeDocuments.length ? 'Desmarcar todos' : 'Marcar todos'}
              </button>
              {lastUpdate && (
                <p className="text-[10px] text-text-muted italic">
                  Última atualização em: {lastUpdate}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Document List organized by Category */}
        <div id="document-list" className="space-y-8">
          {Object.keys(DYNAMIC_DOCUMENTS)
            .filter(key => key === 'geral' || selectedAssets.includes(key))
            .map(categoryKey => (
              <div key={categoryKey} className="space-y-3">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] px-2">
                  {categoryKey === 'geral' ? 'Documentos Gerais' : ASSET_TYPES.find(a => a.id === categoryKey)?.label}
                </h3>
                <div className="space-y-3">
                  {DYNAMIC_DOCUMENTS[categoryKey].map((doc) => (
                    <button
                      key={doc.id}
                      onClick={() => toggleDoc(doc.id)}
                      className={`w-full p-5 rounded-3xl border text-left flex items-center gap-4 transition-all group ${
                        checked.includes(doc.id) 
                          ? 'bg-orange-50/50 border-brand-orange/20' 
                          : 'bg-white border-slate-100 card-shadow hover:border-brand-orange/20'
                      }`}
                    >
                      <div className={`w-7 h-7 rounded-xl border-2 flex items-center justify-center transition-all ${
                        checked.includes(doc.id) 
                          ? 'bg-brand-orange border-brand-orange text-white scale-110' 
                          : 'border-slate-200 bg-slate-50 group-hover:border-brand-orange/30'
                      }`}>
                        {checked.includes(doc.id) && <CheckSquare size={16} />}
                      </div>
                      <div className="flex-1">
                        <p className={`text-sm font-bold leading-tight ${checked.includes(doc.id) ? 'text-brand-orange' : 'text-slate-700'}`}>{doc.label}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
        </div>

        {/* PDF Download Button */}
        <div className="pt-4 pb-10">
          <button
            onClick={generatePDF}
            disabled={isGenerating}
            className="w-full bg-[#F97316] text-white p-6 rounded-3xl shadow-lg shadow-orange-100 flex flex-col items-center justify-center gap-1 hover:scale-[1.02] active:scale-[0.98] transition-all duration-150 group disabled:opacity-70"
          >
            <div className="flex items-center gap-2">
              {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                isActivated ? <Download className="w-5 h-5 group-hover:translate-y-0.5 transition-transform" /> : <Lock className="w-5 h-5" />
              )}
              <span className="font-bold text-base">
                {isGenerating ? 'Gerando relatório...' : (isActivated ? 'Baixar Relatório Profissional em PDF' : 'Liberar Relatório Profissional')}
              </span>
            </div>
            <span className="text-[10px] text-white/80 font-medium">
              {isActivated ? 'Documento estruturado para apresentação ao advogado' : 'Exige código de ativação para download'}
            </span>
          </button>
        </div>

        {/* Activation Modal */}
        <AnimatePresence>
          {showModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={handleCloseModal}
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="relative w-full max-w-sm bg-white rounded-[2rem] p-8 shadow-2xl space-y-6"
              >
                <div className="text-center space-y-2">
                  <div className="w-16 h-16 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Lock size={32} />
                  </div>
                  <h3 className="text-xl font-black text-slate-900 tracking-tight">Ativação Necessária</h3>
                  <p className="text-sm text-slate-500 font-medium">Insira seu código de acesso para liberar o download do relatório profissional.</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-1">Código de Ativação</label>
                    <input 
                      type="text"
                      placeholder="HNM-XXXXXX-D"
                      value={activationCode}
                      onChange={handleCodeChange}
                      className={`w-full p-4 bg-slate-50 border rounded-2xl outline-none font-mono text-center text-lg tracking-widest text-slate-700 placeholder:text-slate-300 transition-all uppercase ${getBorderColor()}`}
                    />
                  </div>

                  {activationError && (
                    <motion.p 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`text-xs font-bold text-center p-3 rounded-xl border ${
                        activationError === "Código validado!" 
                          ? "text-[#28A745] bg-green-50 border-green-100" 
                          : "text-red-500 bg-red-50 border-red-100"
                      }`}
                    >
                      {activationError}
                    </motion.p>
                  )}

                  <button 
                    onClick={handleActivate}
                    disabled={isValidating || activationCode.length < 12}
                    className={`w-full py-5 rounded-2xl font-bold shadow-lg transition-all flex items-center justify-center gap-2 ${
                      activationCode.length === 12
                        ? validateHNM(activationCode)
                          ? 'bg-[#FF8C00] text-white shadow-orange-200 hover:bg-[#E67E00] active:scale-[0.98] pointer-events-auto opacity-100'
                          : 'bg-red-500 text-white shadow-red-200 hover:bg-red-600 active:scale-[0.98] pointer-events-auto opacity-100'
                        : 'bg-slate-300 text-slate-500 shadow-none cursor-not-allowed pointer-events-none opacity-50'
                    }`}
                  >
                    {isValidating ? <Loader2 className="w-5 h-5 animate-spin" /> : '🔓 Ativar Código e Liberar PDF'}
                  </button>

                  <button 
                    onClick={handleCloseModal}
                    className="w-full py-2 text-slate-400 text-[10px] font-bold uppercase tracking-widest hover:text-slate-600 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Success Modal */}
        <AnimatePresence>
          {showSuccessModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowSuccessModal(false)}
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="relative w-full max-w-sm bg-white rounded-[2rem] p-8 shadow-2xl text-center space-y-6"
              >
                <div className="space-y-4">
                  <motion.div 
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                    className="w-20 h-20 bg-green-100 text-green-600 rounded-3xl flex items-center justify-center mx-auto"
                  >
                    <motion.div
                      animate={{ scale: [1, 1.1, 1] }}
                      transition={{ delay: 0.5, duration: 0.5 }}
                    >
                      <Unlock size={40} />
                    </motion.div>
                  </motion.div>
                  
                  <div className="space-y-2">
                    <h3 className="text-xl font-black text-slate-900 tracking-tight">Relatório Desbloqueado</h3>
                    <p className="text-sm text-slate-500 font-medium px-4">Seu acesso profissional foi liberado com sucesso.</p>
                  </div>
                </div>

                <div className="pt-2">
                  <button 
                    onClick={() => {
                      setShowSuccessModal(false);
                      generatePDF();
                    }}
                    className="w-full bg-green-600 text-white py-5 rounded-2xl font-bold shadow-lg shadow-green-100 hover:bg-green-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                  >
                    <Download size={20} />
                    Baixar Relatório Agora
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Toast Notification */}
        <AnimatePresence>
          {showToast && (
            <motion.div 
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              className="fixed bottom-24 left-6 right-6 z-[60] bg-slate-900 text-white p-4 rounded-2xl shadow-2xl flex items-center gap-3 border border-white/10"
            >
              <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center shrink-0">
                <CheckCircle2 size={18} />
              </div>
              <p className="text-sm font-bold">Acesso Liberado! Gerando seu PDF...</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// --- Legal Chat View ---
const MESSAGE_LIMIT = 25;

function LegalChat({ onBack, context, isAILiberada, setIsAILiberada }: { onBack: () => void, context: any, isAILiberada: boolean, setIsAILiberada: (v: boolean) => void }) {
  const [messages, setMessages] = useState<{ role: 'user' | 'ai', text: string }[]>([
    { role: 'ai', text: 'Olá, eu sou seu assistente inteligente para organização de inventário. Como posso ajudar com suas dúvidas hoje?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const [activationCode, setActivationCode] = useState('');
  const [activationError, setActivationError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [credits, setCredits] = useState(0);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);

  useEffect(() => {
    const savedCredits = localStorage.getItem('credits');
    const savedExpires = localStorage.getItem('expiresAt');

    if (savedCredits && savedExpires) {
      setCredits(parseInt(savedCredits));
      setExpiresAt(parseInt(savedExpires));
    }
  }, []);

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatHNMCode(e.target.value);
    setActivationCode(formatted);
    if (formatted.length === 12) {
      if (validateHNM(formatted)) {
        setActivationError("Código validado!");
      } else {
        setActivationError("Código inválido. Verifique os números digitados.");
      }
    } else {
      setActivationError(null);
    }
  };

  const getBorderColor = () => {
    if (activationError === "Código validado!") return 'border-green-500 ring-2 ring-green-500/20';
    if (activationError) return 'border-red-500 ring-2 ring-red-500/20';
    if (activationCode.length === 0) return 'border-orange-200';
    if (activationCode.length < 12) return 'border-blue-500 ring-2 ring-blue-500/20';
    if (validateHNM(activationCode)) return 'border-green-500 ring-2 ring-green-500/20';
    return 'border-red-500 ring-2 ring-red-500/20';
  };

  const handleActivate = async () => {
    const code = activationCode.trim().toUpperCase();
    if (isValidating) return;
    
    if (!validateHNM(code)) {
      setActivationError("Código inválido. Verifique os números digitados.");
      return;
    }
    
    setIsValidating(true);
    setActivationError(null);

    try {
      const response = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      const result = await response.json();

      if (result.valid) {
        const newCredits = 25;
        const newExpiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

        localStorage.setItem('activationCode', code);
        localStorage.setItem('credits', newCredits.toString());
        localStorage.setItem('expiresAt', newExpiresAt.toString());
        localStorage.setItem('isAILiberada', 'true');

        setIsAILiberada(true);
        setCredits(newCredits);
        setExpiresAt(newExpiresAt);
        setActivationCode('');
        setError(null);
        setShowModal(false);
      } else {
        setActivationError(result.message || "Código já utilizado ou inválido");
      }
    } catch (err) {
      console.error('Validation error:', err);
      setActivationError("Erro na comunicação com o servidor.");
    } finally {
      setIsValidating(false);
    }
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setActivationCode('');
    setActivationError(null);
  };

  const handleSend = async () => {
    if (!input.trim() || loading || !isAILiberada) return;

    const savedCredits = localStorage.getItem('credits');
    const savedExpires = localStorage.getItem('expiresAt');

    const currentCredits = parseInt(savedCredits || '0');
    const expiry = parseInt(savedExpires || '0');
    const now = Date.now();

    if (!isAILiberada || !savedCredits || !savedExpires) {
      setError("É necessário ativar um código para utilizar o Modo Inteligente.");
      return;
    }

    if (now > expiry) {
      setError("Seu código expirou ou os créditos foram utilizados.");
      return;
    }

    if (currentCredits <= 0) {
      setError("Seus créditos do Modo Inteligente terminaram. Para continuar utilizando o assistente, ative um novo código de acesso.");
      return;
    }

    const userMsg = input;
    setInput('');
    setError(null);
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      
      const contextPrompt = `
DADOS DO PROCESSO ATIVO:
- Estrutura de Herdeiros: ${JSON.stringify(context.heirState)}
- UF do Inventário: ${context.itcmdUF}
- Valor Estimado de Bens: ${context.itcmdValue || 'Não informado'}
- Imposto Estimado (ITCMD): ${context.itcmdResult ? `R$ ${context.itcmdResult.toLocaleString('pt-BR')}` : 'Não calculado'}
- Interação Atual: ${Math.floor(messages.length / 2) + 1} de ${MESSAGE_LIMIT}

RESUMO RECENTE DO CONTEXTO:
${messages.slice(-4).map(m => `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${m.text}`).join('\n')}

PERGUNTA ATUAL:
${userMsg}
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: contextPrompt,
        config: {
          systemInstruction: `Você é o Assistente Inteligente do app Herança na Mão.

Sua função é oferecer orientação educativa e estratégica sobre inventário no Brasil, com linguagem clara, organizada e objetiva.

Você NÃO substitui advogado e NÃO presta consultoria jurídica formal.

CONTEXTO
Você sempre receberá:
Dados estruturados do processo ativo (herdeiros, bens, dívidas, regime de bens, etc.).
Resumo recente do contexto.
Pergunta atual do usuário.
Sempre considere o contexto fornecido antes de responder.

ESTILO E LINGUAGEM (PRIORIDADE ALTA)
- Meta de Redução: Entregar a mesma informação com 40% menos palavras que o padrão atual.
- Corte de Excessos: Remova frases como "no entanto", "vale ressaltar que", ou explicações de exceções raríssimas.
- Não repita a pergunta do usuário na resposta.
- Proibição de 'Juridiquês': Substitua termos como "patrimônio", "espólio" ou "líquida" por palavras do dia a dia (bens, sobra, dívidas).
- Não use emojis. Não escreva textos longos ou acadêmicos.
- Exemplos: Remova parágrafos de exemplos hipotéticos, a menos que o usuário peça um exemplo específico.

DIRETRIZ DE RESPOSTA PARA DOCUMENTAÇÃO
- Listagem Direta: Ao ser questionado sobre documentos, forneça apenas o Nome do Documento e, se necessário, Onde consegui-lo.
- Proibição de Glossário: Não explique para que serve o documento (ex: não diga que a Certidão de Óbito "oficializa o falecimento").

CENÁRIOS DE LOCAL (ONDE FAZER O INVENTÁRIO)
- Cartório: Amigável/Rápido (Herdeiros maiores e em consenso).
- Judicial: Obrigatório (Menores, testamento ou conflito).

ESTRUTURA OBRIGATÓRIA DA RESPOSTA
1. Conclusão Direta: Comece com a conclusão direta (Sim/Não ou a regra principal).
2. Explicação Objetiva: Use no máximo 2 ou 3 tópicos (bullet points) para explicar cálculos ou divisões.
3. Exemplo Prático: Use exemplos práticos com os números que o usuário fornecer no contexto.
4. Próximo Passo: Finalize sempre com uma única ação prática sugerida.
5. Disclaimer Fixo: Encerre obrigatoriamente com a frase: "Este app organiza seus dados para o inventário, mas não substitui a consulta com um advogado."

ESCOPO PERMITIDO
Você pode tratar exclusivamente de:
Inventário judicial ou extrajudicial, Herança e partilha de bens, Dívidas do falecido, Direitos de herdeiros e meeiros, ITCMD (apenas explicação geral), Organização de documentos e Etapas do processo.
Se o usuário perguntar algo fora desse escopo, responda educadamente que o suporte é exclusivo para inventário e herança.

REGRAS DE CRÉDITOS
Quando o usuário estiver próximo de esgotar os créditos do Modo Inteligente (restando 1 ou 2 interações), continue respondendo normalmente e adicione APENAS esta mensagem ao final:
"Atenção: você está próximo de utilizar todos os seus créditos do Modo Inteligente."

Quando os créditos do Modo Inteligente do usuário acabarem, exiba EXATAMENTE o texto abaixo:
"Seus créditos do Modo Inteligente terminaram.

Para continuar utilizando o assistente, ative um novo código de acesso."`,
        }
      });

      let aiText = response.text || 'Não consegui responder no momento. Tente novamente.';
      
      // Add credit warning if close to limit (1 or 2 interactions left)
      if (messages.length >= (MESSAGE_LIMIT - 2) * 2 + 1) {
        aiText += "\n\n" + "Atenção: você está próximo de utilizar todos os seus créditos do Modo Inteligente.";
      }

      setMessages(prev => [...prev, { role: 'ai', text: aiText }]);
      
      // Decrementar créditos
      const newCredits = Math.max(0, currentCredits - 1);
      setCredits(newCredits);
      localStorage.setItem('credits', newCredits.toString());
    } catch (err) {
      console.error('Chat Error:', err);
      setError('Não consegui responder no momento. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen max-h-screen">
      <header className="p-6 flex items-center gap-4 bg-white border-b border-gray-100 shrink-0">
        <button onClick={onBack} className="p-2 -ml-2"><ArrowLeft size={24} /></button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-purple rounded-full flex items-center justify-center text-white">
            <MessageSquare size={20} />
          </div>
          <div>
            <h1 className="text-sm font-bold leading-none">Assistente Organizacional</h1>
            <p className="text-[10px] text-green-500 font-bold uppercase mt-1">Online agora</p>
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col min-h-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-8 bg-slate-50/30">
          <Disclaimer />
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] p-5 rounded-3xl text-sm leading-relaxed shadow-sm transition-all ${
                msg.role === 'user' 
                  ? 'bg-brand-purple text-white rounded-tr-none ml-8 shadow-purple-100' 
                  : 'bg-white text-slate-700 rounded-tl-none mr-8 border border-slate-100'
              }`}>
                {msg.text}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-white p-4 rounded-2xl rounded-tl-none shadow-sm border border-gray-100 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-brand-purple" />
                <span className="text-xs text-text-muted">Analisando...</span>
              </div>
            </div>
          )}
          {error && (
            <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-xs text-center">
              {error}
            </div>
          )}
        </div>

        <div className="p-4 bg-white border-t border-gray-100 shrink-0 pb-28 space-y-4">
          {!isAILiberada && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-orange-50 border border-orange-100 rounded-2xl p-4 shadow-sm"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-orange-600">
                  <Lock size={14} className="fill-orange-600/20" />
                  <span className="text-[10px] font-black uppercase tracking-wider">Ativação do Modo Inteligente</span>
                </div>
                <span className="text-[10px] font-bold text-orange-600 bg-white px-2 py-0.5 rounded-full border border-orange-200">
                  25 créditos
                </span>
              </div>
              
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input 
                    type="text"
                    placeholder="HNM-XXXXXX-D"
                    value={activationCode}
                    onChange={handleCodeChange}
                    className={`w-full bg-white border rounded-xl px-4 py-3 text-sm font-mono tracking-wider outline-none transition-all placeholder:text-orange-200 ${getBorderColor()}`}
                  />
                </div>
                <button 
                  onClick={handleActivate}
                  disabled={isValidating || activationCode.length < 12}
                  className={`px-4 rounded-xl text-xs font-bold shadow-lg transition-all whitespace-nowrap flex items-center justify-center gap-2 ${
                    activationCode.length === 12
                      ? validateHNM(activationCode)
                        ? 'bg-[#FF8C00] text-white shadow-orange-200 hover:bg-[#E67E00] active:scale-[0.98] pointer-events-auto opacity-100'
                        : 'bg-red-500 text-white shadow-red-200 hover:bg-red-600 active:scale-[0.98] pointer-events-auto opacity-100'
                      : 'bg-slate-300 text-slate-500 shadow-none cursor-not-allowed pointer-events-none opacity-50'
                  }`}
                >
                  {isValidating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Ativar Código'}
                </button>
              </div>
              {activationError && (
                <p className={`text-[10px] font-bold mt-2 px-1 ${
                  activationError === "Código validado!" ? "text-[#28A745]" : "text-red-500"
                }`}>{activationError}</p>
              )}
            </motion.div>
          )}

          {isAILiberada && credits <= 0 && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-orange-50 border border-orange-100 rounded-2xl p-4 shadow-sm text-center space-y-3"
            >
              <div className="space-y-1">
                <p className="text-sm font-bold text-orange-900">Seus créditos do Modo Inteligente terminaram.</p>
                <p className="text-[10px] font-medium text-orange-700">Para continuar utilizando o assistente, ative um novo código de acesso.</p>
              </div>
              <button 
                onClick={() => setShowModal(true)}
                className="w-full bg-[#F97316] text-white py-3 rounded-xl text-xs font-bold shadow-lg shadow-orange-100 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <Unlock size={14} />
                Ativar Código
              </button>
            </motion.div>
          )}

          {isAILiberada && credits > 0 && (
            <div className="flex items-center justify-between px-2">
              <div className="flex items-center gap-2 text-slate-400">
                <Unlock size={12} />
                <p className="text-[10px] font-bold uppercase tracking-wider">✨ Modo Inteligente Ativo</p>
              </div>
              <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                {credits} interações restantes
              </span>
            </div>
          )}

          <div className="flex gap-2">
            <input 
              type="text" 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder={!isAILiberada || credits <= 0 ? "Ative o modo inteligente para continuar" : (messages.length >= MESSAGE_LIMIT * 2 ? "Limite atingido" : "Tire sua dúvida jurídica...")}
              disabled={loading || messages.length >= MESSAGE_LIMIT * 2 || !isAILiberada || credits <= 0}
              className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-brand-purple/20 disabled:opacity-50"
            />
            <button 
              onClick={handleSend}
              disabled={loading || !input.trim() || messages.length >= MESSAGE_LIMIT * 2 || !isAILiberada || credits <= 0}
              className="bg-brand-purple text-white w-12 h-12 rounded-xl flex items-center justify-center shadow-lg shadow-purple-100 active:scale-95 disabled:opacity-50"
            >
              <Send size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* Activation Modal */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleCloseModal}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-sm bg-white rounded-[2rem] p-8 shadow-2xl space-y-6"
            >
              <div className="text-center space-y-2">
                <div className="w-16 h-16 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Lock size={32} />
                </div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight">Ativação necessária</h3>
                <p className="text-sm text-slate-500 font-medium">Insira seu código para liberar o Assistente.</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-1">Código de Ativação</label>
                  <input 
                    type="text"
                    placeholder="HNM-XXXXXX-D"
                    value={activationCode}
                    onChange={handleCodeChange}
                    className={`w-full p-4 bg-slate-50 border rounded-2xl outline-none font-mono text-center text-lg tracking-widest text-slate-700 placeholder:text-slate-300 transition-all uppercase ${getBorderColor()}`}
                  />
                </div>

                {activationError && (
                  <motion.p 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`text-xs font-bold text-center p-3 rounded-xl border ${
                      activationError === "Código validado!" 
                        ? "text-[#28A745] bg-green-50 border-green-100" 
                        : "text-red-500 bg-red-50 border-red-100"
                    }`}
                  >
                    {activationError}
                  </motion.p>
                )}

                <button 
                  onClick={handleActivate}
                  disabled={isValidating || activationCode.length < 12}
                  className={`w-full py-5 rounded-2xl font-bold shadow-lg transition-all flex items-center justify-center gap-2 ${
                    activationCode.length === 12
                      ? validateHNM(activationCode)
                        ? 'bg-[#FF8C00] text-white shadow-orange-200 hover:bg-[#E67E00] active:scale-[0.98] pointer-events-auto opacity-100'
                        : 'bg-red-500 text-white shadow-red-200 hover:bg-red-600 active:scale-[0.98] pointer-events-auto opacity-100'
                      : 'bg-slate-300 text-slate-500 shadow-none cursor-not-allowed pointer-events-none opacity-50'
                  }`}
                >
                  {isValidating ? <Loader2 className="w-5 h-5 animate-spin" /> : '🔓 Ativar Código e Liberar Assistente'}
                </button>

                <button 
                  onClick={handleCloseModal}
                  className="w-full py-2 text-slate-400 text-[10px] font-bold uppercase tracking-widest hover:text-slate-600 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
