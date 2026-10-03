import './locale';
import { mount } from 'svelte';
import Settings from './settings/Settings.svelte';
import './app.css';

mount(Settings, { target: document.getElementById('app')! });
