import type { Component } from 'svelte';
import BikeIcon from '@lucide/svelte/icons/bike';
import BoxIcon from '@lucide/svelte/icons/box';
import CameraIcon from '@lucide/svelte/icons/camera';
import CarIcon from '@lucide/svelte/icons/car';
import DrillIcon from '@lucide/svelte/icons/drill';
import MountainIcon from '@lucide/svelte/icons/mountain';
import PackageIcon from '@lucide/svelte/icons/package';
import PartyPopperIcon from '@lucide/svelte/icons/party-popper';
import ProjectorIcon from '@lucide/svelte/icons/projector';
import SailboatIcon from '@lucide/svelte/icons/sailboat';
import ScooterIcon from '@lucide/svelte/icons/scooter';
import SnowflakeIcon from '@lucide/svelte/icons/snowflake';
import SpeakerIcon from '@lucide/svelte/icons/speaker';
import TentIcon from '@lucide/svelte/icons/tent';
import ArmchairIcon from '@lucide/svelte/icons/armchair';

/** A fitting icon for a category, guessed from its name or slug in the shop's languages. */
const RULES: [RegExp, Component][] = [
  [/scoot|roller|tõuke|スクーター/i, ScooterIcon],
  [/bike|bicycle|cycl|fahrrad|vélo|velo|bici|jalgrat|自転車/i, BikeIcon],
  [/camera|photo|lens|video|kamera|appareil|cámara|foto|カメラ/i, CameraIcon],
  [/camp|\btent|zelt|tente|carpa|telk|キャンプ/i, TentIcon],
  [/party|event|fest|fiesta|fête|pidu|üritus|イベント|パーティ/i, PartyPopperIcon],
  [/kayak|boat|boot|bateau|barco|paat|\bsup\b|paddle|water|wasser|vesi|カヤック|ボート/i, SailboatIcon],
  [/\bski|snow|schnee|neige|nieve|lumi|スキー|スノー/i, SnowflakeIcon],
  [/outdoor|hike|hiking|mountain|wander|plein|aire libre|matk|välitingimus|アウトドア/i, MountainIcon],
  [/audio|sound|speaker|music|musik|\bson\b|sonido|heli|音響/i, SpeakerIcon],
  [/projector|beamer|screen|proje|プロジェクター/i, ProjectorIcon],
  [/tool|werkzeug|outil|herramienta|tööriist|工具/i, DrillIcon],
  [/furniture|chair|table|möbel|meuble|mueble|mööbel|家具/i, ArmchairIcon],
  [/\bcars?\b|\bauto|\bvans?\b|voiture|coche|車/i, CarIcon],
  [/access|zubehör|accessoire|accesorio|tarvik|アクセサリ/i, PackageIcon],
];

export function categoryIcon(name: string, slug = ''): Component {
  const text = `${name} ${slug}`;
  return RULES.find(([re]) => re.test(text))?.[1] ?? BoxIcon;
}
