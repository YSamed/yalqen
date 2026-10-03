import './locale';
import { mount } from 'svelte';
import CommandBar from './command-bar/CommandBar.svelte';
import './app.css';

mount(CommandBar, { target: document.getElementById('app')! });
