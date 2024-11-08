import { FloorPlanViewer } from '../components/FloorPlanViewer';
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>Floor Plan Viewer</h1>
        <FloorPlanViewer 
          floorNumber={1}
        />
      </main>
    </div>
  );
}
