import './locale';
import { mount } from 'svelte';
import App from './window/App.svelte';
import { installTooltips } from './window/tooltips';
import './app.css';

mount(App, { target: document.getElementById('app')! });
installTooltips(window.yalqen.send);
