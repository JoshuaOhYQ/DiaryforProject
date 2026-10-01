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
    { name: 'Oh Yu Qiao', colour: '#2f7fc1' },
    { name: 'Tay Shuen Min', colour: '#d0556d' },
    { name: 'Jordan Douglas Su E-Wern', colour: '#2e9a6b' },
    { name: 'Puteri Amelya Dania', colour: '#d4892a' },
  ],
  features: [
    {
      name: 'Smart Home (MQTT)',
      description: 'MQTT broker, ESP32 house node and appliance control, with safety checks between the AI and the appliances.',
      status: 'In progress',
      colour: '#1f9d8a',
      owners: ['Oh Yu Qiao'],
    },
    { name: 'Voice (STT/TTS)', colour: '#8a63c9' },
    { name: 'LLM backend', colour: '#3b6fd1' },
    { name: 'Robot hardware (ESP32/sensors)', colour: '#c4604a' },
    { name: 'Diary/Memory', colour: '#6d9a2f' },
    { name: 'Safety & Alerts', colour: '#d4892a' },
    { name: 'Report', colour: '#6f7f8f' },
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
