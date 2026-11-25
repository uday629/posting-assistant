// Local models that can be installed with one click through Ollama. gb = approximate download size (Q4 quant).
// tags: vision = understands screenshots, tools = good at agent/tool work, code, reasoning, uncensored, small.
const CATALOG = [
  // best all-round picks for this app
  { id: 'qwen3-vl:8b-instruct', gb: 6.1, tags: ['vision', 'tools', 'recommended'], note: 'Best all-round choice: sees screenshots, follows tool steps, answers fast.' },
  { id: 'qwen3-vl:4b-instruct', gb: 3.3, tags: ['vision', 'tools', 'small'], note: 'Smaller vision model for 6-8 GB GPUs.' },
  { id: 'qwen3-vl:2b-instruct', gb: 1.9, tags: ['vision', 'small'], note: 'Tiny vision model for weak PCs.' },
  { id: 'qwen3-vl:30b', gb: 19.5, tags: ['vision', 'tools', 'reasoning'], note: 'Large MoE vision model, needs 24 GB VRAM or VRAM + RAM.' },
  { id: 'qwen3-vl:32b', gb: 21, tags: ['vision', 'tools', 'reasoning'], note: 'Dense large vision model, very accurate, slow without a big GPU.' },
  { id: 'qwen3:4b', gb: 2.6, tags: ['tools', 'small'], note: 'Small text model, fast on any GPU.' },
  { id: 'qwen3:8b', gb: 5.2, tags: ['tools', 'reasoning'], note: 'Strong 8B text model (no vision).' },
  { id: 'qwen3:14b', gb: 9.3, tags: ['tools', 'reasoning'], note: 'Smarter text model for 12-16 GB GPUs.' },
  { id: 'qwen3:30b', gb: 19, tags: ['tools', 'reasoning'], note: 'MoE, only ~3B active: smart and still fast partly in RAM.' },
  { id: 'qwen3:32b', gb: 20, tags: ['tools', 'reasoning'], note: 'Dense 32B, high quality, needs 24 GB VRAM.' },
  { id: 'qwen3.5:4b', gb: 3.3, tags: ['vision', 'small'], note: 'Newer small multimodal Qwen.' },
  { id: 'qwen3-coder:30b', gb: 19, tags: ['code', 'tools'], note: 'Coding agent model (MoE).' },
  { id: 'qwen2.5-coder:7b', gb: 4.7, tags: ['code'], note: 'Fast coding model.' },
  { id: 'qwen2.5-coder:14b', gb: 9, tags: ['code'], note: 'Better coding model for 12-16 GB GPUs.' },
  { id: 'qwen2.5vl:7b', gb: 6, tags: ['vision'], note: 'Strong at reading screens, documents and UI.' },
  { id: 'gpt-oss:20b', gb: 14, tags: ['tools', 'reasoning'], note: 'OpenAI open-weight reasoning model (MoE).' },
  { id: 'gpt-oss:120b', gb: 65, tags: ['tools', 'reasoning'], note: 'Very large, for workstation PCs only.' },
  { id: 'gemma3:4b', gb: 3.3, tags: ['vision', 'small'], note: 'Google small multimodal model.' },
  { id: 'gemma3:12b', gb: 8.1, tags: ['vision'], note: 'Google multimodal, good writing and vision.' },
  { id: 'gemma3:27b', gb: 17, tags: ['vision', 'reasoning'], note: 'Google large multimodal.' },
  { id: 'gemma3n:e4b', gb: 7.5, tags: ['small'], note: 'Efficient on-device model.' },
  { id: 'llama3.1:8b', gb: 4.9, tags: ['tools'], note: 'Meta general model, reliable tool use.' },
  { id: 'llama3.2:3b', gb: 2, tags: ['small'], note: 'Meta small model.' },
  { id: 'llama3.2-vision:11b', gb: 7.8, tags: ['vision'], note: 'Meta vision model.' },
  { id: 'mistral:7b', gb: 4.4, tags: ['small'], note: 'Classic fast 7B model.' },
  { id: 'mistral-nemo:12b', gb: 7.1, tags: ['tools'], note: 'Mistral 12B with long context.' },
  { id: 'mistral-small3.2:24b', gb: 15, tags: ['vision', 'tools'], note: 'Vision + strong tool use.' },
  { id: 'devstral:24b', gb: 14, tags: ['code', 'tools'], note: 'Mistral coding agent model.' },
  { id: 'magistral:24b', gb: 14, tags: ['reasoning'], note: 'Mistral reasoning model.' },
  { id: 'phi4:14b', gb: 9.1, tags: ['reasoning'], note: 'Microsoft, strong reasoning for its size.' },
  { id: 'phi4-mini:3.8b', gb: 2.5, tags: ['small', 'tools'], note: 'Microsoft small model.' },
  { id: 'deepseek-r1:8b', gb: 5.2, tags: ['reasoning'], note: 'Thinks step by step, slower answers.' },
  { id: 'deepseek-r1:14b', gb: 9, tags: ['reasoning'], note: 'Bigger reasoning model.' },
  { id: 'deepseek-r1:32b', gb: 20, tags: ['reasoning'], note: 'Large reasoning model.' },
  { id: 'deepseek-coder-v2:16b', gb: 8.9, tags: ['code'], note: 'MoE coding model.' },
  { id: 'granite3.3:8b', gb: 4.9, tags: ['tools'], note: 'IBM model tuned for tools.' },
  { id: 'granite3.2-vision:2b', gb: 2.4, tags: ['vision', 'small'], note: 'Tiny document/screen reader.' },
  { id: 'minicpm-v:8b', gb: 5.5, tags: ['vision'], note: 'Fast OCR-friendly vision model.' },
  { id: 'llava:7b', gb: 4.7, tags: ['vision'], note: 'Older vision model.' },
  { id: 'moondream:1.8b', gb: 1.7, tags: ['vision', 'small'], note: 'Very small image describer.' },
  { id: 'cogito:14b', gb: 9, tags: ['reasoning', 'tools'], note: 'Hybrid reasoning model.' },
  { id: 'hermes3:8b', gb: 4.7, tags: ['tools'], note: 'Nous Hermes, follows instructions closely.' },
  // fewer built-in refusals (use with the approval system on)
  { id: 'dolphin3:8b', gb: 4.9, tags: ['uncensored', 'tools'], note: 'Dolphin 3 (Llama 3.1): few refusals, follows the owner.' },
  { id: 'dolphin-mistral:7b', gb: 4.1, tags: ['uncensored'], note: 'Dolphin on Mistral 7B.' },
  { id: 'dolphin-mixtral:8x7b', gb: 26, tags: ['uncensored'], note: 'Large Dolphin MoE.' },
  { id: 'llama2-uncensored:7b', gb: 3.8, tags: ['uncensored', 'small'], note: 'Older uncensored Llama 2.' },
  { id: 'wizard-vicuna-uncensored:13b', gb: 7.4, tags: ['uncensored'], note: 'Older uncensored 13B.' }
];

const CTX_GB = 1.5;
function fit(gb, hw) {
  const vram = hw?.vramGB || 0;
  const need = gb + CTX_GB;
  if (vram && need <= vram * 0.92) return 'fits';
  if (vram && need <= vram * 0.92 + Math.max(0, (hw.ramGB || 0) - 16) * 0.5) return 'ram';
  if (!vram && need <= (hw?.ramGB || 8) * 0.5) return 'cpu';
  return 'too-big';
}
function withFit(hw, installedIds = []) {
  return CATALOG.map((m) => ({ ...m, fit: fit(m.gb, hw), installed: installedIds.includes(m.id) }));
}
module.exports = { CATALOG, withFit };
