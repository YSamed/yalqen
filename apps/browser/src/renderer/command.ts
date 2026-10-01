import './locale';
import { mount } from 'svelte';
import CommandBar from './CommandBar.svelte';
import './app.css';

mount(CommandBar, { target: document.getElementById('app')! });
