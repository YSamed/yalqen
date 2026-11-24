import './locale';
import { mount } from 'svelte';
import FloatingChat from './window/FloatingChat.svelte';
import './app.css';

mount(FloatingChat, { target: document.getElementById('app')! });
