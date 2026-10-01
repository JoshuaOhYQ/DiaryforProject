import type { ProjectTemplate } from './template.ts';

/**
 * PIPER, IDP1 Group 2, Sunway University.
 * Roles are deliberately blank: fill them in on the Team page.
 */
export const piperTemplate: ProjectTemplate = {
  key: 'piper',
  label: 'PIPER — dementia-assistive robot',
  description: 'IDP1 Group 2 (Sunway University): team of four, seven subsystems, hardware deadline milestone.',
  project: {
    name: 'PIPER — Dementia-Assistive Robot',
    description: 'A stationary dementia-assistive robot.',
    organisation: 'Sunway University',
    course: 'IDP1 — Electronic & Electrical Engineering',
    group: 'Group 2',
    supervisor: 'Dr. Chia Wai Chong',
    repoUrl: 'https://github.com/JoshuaOhYQ/Dementia-Assistive-Robot-Piper',
  },
  members: [
    { name: 'Oh Yu Qiao', colour: '#2a78d6' },
    { name: 'Tay Shuen Min', colour: '#eb6834' },
    { name: 'Jordan Douglas Su E-Wern', colour: '#1baf7a' },
    { name: 'Puteri Amelya Dania', colour: '#eda100' },
  ],
  features: [
    {
      name: 'Smart Home (MQTT)',
      description: 'MQTT broker, ESP32 house node and appliance control, with safety checks between the AI and the appliances.',
      status: 'In progress',
      colour: '#2a78d6',
      owners: ['Oh Yu Qiao'],
    },
    { name: 'Voice (STT/TTS)', colour: '#eb6834' },
    { name: 'LLM backend', colour: '#1baf7a' },
    { name: 'Robot hardware (ESP32/sensors)', colour: '#eda100' },
    { name: 'Diary/Memory', colour: '#e87ba4' },
    { name: 'Safety & Alerts', colour: '#008300' },
    { name: 'Report', colour: '#4a3aa7' },
  ],
  tasks: [
    {
      name: 'Hardware deadline',
      feature: 'Robot hardware (ESP32/sensors)',
      start: '2026-10-09',
      milestone: true,
      notes: 'From the smart-home work log: order the second ESP32 before the 9 October hardware deadline.',
    },
  ],
};
